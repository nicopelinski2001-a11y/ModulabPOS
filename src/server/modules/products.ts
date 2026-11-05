import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { auth } from '../lib/auth.js';
import { command } from '../lib/commands.js';
import { withUser, audit, type DB } from '../lib/db.js';
import { AppError, requireFound } from '../lib/errors.js';
import { productSchema, uuid, quantity, can, type User } from '../../shared/domain.js';
const createSchema = productSchema.extend({
  initial_stock_milli: z.number().int().min(0).max(1_000_000_000).default(0),
});
function visibleProduct(user: User, row: Record<string, unknown>) {
  if (!can(user.role, 'products') && !can(user.role, 'reports')) delete row.cost_cents;
  return row;
}
async function createProduct(db: DB, user: User, b: z.infer<typeof createSchema>) {
  if (b.unit === 'unit' && b.initial_stock_milli % 1000 !== 0)
    throw new AppError(400, 'Los productos por unidad requieren cantidades enteras.');
  const { initial_stock_milli, ...data } = b;
  data.barcode = data.barcode || null;
  const keys = Object.keys(data);
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO products(tenant_id,${keys.join(',')}) VALUES($1,${keys.map((_, i) => `$${i + 2}`).join(',')}) RETURNING *`,
    [user.tenant_id, ...Object.values(data)],
  );
  if (initial_stock_milli)
    await db.query(
      "INSERT INTO inventory_movements(tenant_id,product_id,user_id,qty_milli,kind,reference_id,reason) VALUES($1,$2,$3,$4,'opening',$5,'Stock inicial')",
      [user.tenant_id, row.id, user.user_id, initial_stock_milli, randomUUID()],
    );
  await audit(db, user, 'product.create', row.id);
  return { ...row, stock_milli: initial_stock_milli };
}
export async function productRoutes(app: FastifyInstance) {
  app.get('/api/products', async (req) => {
    const user = auth(req);
    const q = z
      .object({
        q: z.string().max(100).default(''),
        category: z.string().max(160).default(''),
        all: z.enum(['true', 'false']).default('false'),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .parse(req.query);
    return withUser(user, async (db) => {
      const args = [q.q, q.category, q.all === 'true', q.limit, q.offset];
      const where =
        "WHERE ($3 OR active) AND ($1='' OR name ILIKE '%'||$1||'%' OR sku ILIKE '%'||$1||'%' OR barcode=$1) AND ($2='' OR category=$2)";
      return {
        items: (
          await db.query(
            `SELECT * FROM products ${where} ORDER BY (coalesce(barcode=$1,false) OR lower(sku)=lower($1)) DESC,name,id LIMIT $4 OFFSET $5`,
            args,
          )
        ).rows.map((p) => visibleProduct(user, p)),
        total: (
          await db.query(`SELECT count(*)::int AS n FROM products ${where}`, args.slice(0, 3))
        ).rows[0].n,
      };
    });
  });
  app.get('/api/products/categories', async (req) =>
    withUser(auth(req), async (db) =>
      (
        await db.query('SELECT DISTINCT category FROM products WHERE active ORDER BY category')
      ).rows.map((x) => x.category),
    ),
  );
  app.get('/api/products/:id', async (req) => {
    const user = auth(req);
    const id = uuid.parse((req.params as { id: string }).id);
    return withUser(user, async (db) =>
      visibleProduct(
        user,
        requireFound((await db.query('SELECT * FROM products WHERE id=$1', [id])).rows[0]),
      ),
    );
  });
  app.post('/api/products', async (req) => {
    const user = auth(req, 'products');
    const b = createSchema.parse(req.body);
    return withUser(user, (db) => createProduct(db, user, b));
  });
  app.put('/api/products/:id', async (req) => {
    const user = auth(req, 'products');
    const id = uuid.parse((req.params as { id: string }).id);
    const b = productSchema.parse(req.body);
    return withUser(user, async (db) => {
      const old = requireFound(
        (await db.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [id])).rows[0],
      );
      if (
        old.unit !== b.unit &&
        (await db.query('SELECT 1 FROM inventory_movements WHERE product_id=$1 LIMIT 1', [id]))
          .rowCount
      )
        throw new AppError(
          409,
          'La unidad de medida no puede cambiar después de registrar movimientos.',
        );
      b.barcode = b.barcode || null;
      const keys = Object.keys(b);
      const row = requireFound(
        (
          await db.query(
            `UPDATE products SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')},updated_at=now() WHERE id=$${keys.length + 1} RETURNING *`,
            [...Object.values(b), id],
          )
        ).rows[0],
      );
      await audit(db, user, 'product.update', id, {
        before: { price_cents: old.price_cents, cost_cents: old.cost_cents },
        after: b,
      });
      return row;
    });
  });
  app.post('/api/products/import', async (req) => {
    const user = auth(req, 'products');
    const b = z
      .object({ products: z.array(createSchema).min(1).max(500) })
      .strict()
      .parse(req.body);
    return withUser(user, async (db) => {
      const ids = [];
      for (const row of b.products) ids.push((await createProduct(db, user, row)).id);
      await audit(db, user, 'product.import', null, { count: ids.length });
      return { count: ids.length };
    });
  });
  app.post('/api/products/prices', async (req) => {
    const user = auth(req, 'products');
    const b = z
      .object({
        category: z.string().max(160),
        increase_basis_points: z.number().int().min(-9900).max(100000),
        idempotency_key: uuid,
      })
      .strict()
      .parse(req.body);
    return withUser(user, (db) =>
      command(db, user, b.idempotency_key, 'product.prices', b, async () => {
        const result = await db.query(
          "UPDATE products SET price_cents=greatest(1,(price_cents*(10000+$1::bigint)+5000)/10000),updated_at=now() WHERE active AND ($2='' OR category=$2)",
          [b.increase_basis_points, b.category],
        );
        await audit(db, user, 'product.prices', null, { ...b, count: result.rowCount });
        return { count: result.rowCount };
      }),
    );
  });
  app.get('/api/inventory', async (req) => {
    const user = auth(req, 'inventory');
    const q = z.object({ product_id: uuid.optional() }).parse(req.query);
    return withUser(
      user,
      async (db) =>
        (
          await db.query(
            'SELECT m.*,p.name AS product_name,u.name AS user_name FROM inventory_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id WHERE ($1::uuid IS NULL OR m.product_id=$1) ORDER BY m.created_at DESC LIMIT 300',
            [q.product_id ?? null],
          )
        ).rows,
    );
  });
  app.post('/api/inventory/adjust', async (req) => {
    const user = auth(req, 'inventory');
    const b = z
      .object({
        product_id: uuid,
        qty_milli: quantity.or(z.number().int().min(-1_000_000_000).max(-1)),
        reason: z.string().trim().min(5).max(300),
        idempotency_key: uuid,
      })
      .strict()
      .parse(req.body);
    return withUser(user, (db) =>
      command(db, user, b.idempotency_key, 'inventory.adjust', { ...b }, async () => {
        const p = requireFound(
          (await db.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [b.product_id])).rows[0],
        );
        if (p.unit === 'unit' && b.qty_milli % 1000 !== 0)
          throw new AppError(400, 'Ingresá una cantidad entera.');
        const existing = (
          await db.query(
            "SELECT * FROM inventory_movements WHERE kind='adjustment' AND reference_id=$1 AND product_id=$2",
            [b.idempotency_key, b.product_id],
          )
        ).rows[0];
        if (existing) {
          if (existing.qty_milli !== b.qty_milli || existing.reason !== b.reason)
            throw new AppError(409, 'La clave de reintento tiene otros datos.');
          return existing;
        }
        const {
          rows: [row],
        } = await db.query(
          "INSERT INTO inventory_movements(tenant_id,product_id,user_id,qty_milli,kind,reference_id,reason) VALUES($1,$2,$3,$4,'adjustment',$5,$6) RETURNING *",
          [user.tenant_id, b.product_id, user.user_id, b.qty_milli, b.idempotency_key, b.reason],
        );
        await audit(db, user, 'inventory.adjust', row.id, b);
        return row;
      }),
    );
  });
}
