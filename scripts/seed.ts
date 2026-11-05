import pg from 'pg';
import { createTenant } from './create-tenant.js';
if (process.env.NODE_ENV === 'production')
  throw new Error('El seed está deshabilitado en producción.');
if (
  !process.env.ADMIN_DATABASE_URL ||
  !process.env.SEED_PASSWORD ||
  process.env.SEED_PASSWORD.includes('CHANGE_ME')
)
  throw new Error('Configurá ADMIN_DATABASE_URL y SEED_PASSWORD (12 caracteres o más).');
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await db.connect();
try {
  if ((await db.query("SELECT 1 FROM tenants WHERE slug='modulab'")).rowCount) {
    console.log('El comercio de evaluación ya existe; no se modificó.');
  } else {
    const { tenant, owner } = await createTenant(db, {
      slug: 'modulab',
      name: 'Mi comercio',
      email: 'admin@modulab.local',
      password: process.env.SEED_PASSWORD,
      ownerName: 'Administración',
    });
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenant.id]);
    const {
      rows: [supplier],
    } = await db.query(
      "INSERT INTO suppliers(tenant_id,name,contact) VALUES($1,'Distribuidora Central','ventas@distribuidora.example') RETURNING id",
      [tenant.id],
    );
    const products = [
      [
        'BEB-001',
        '7790895000997',
        'Coca-Cola original 500 ml',
        'Bebidas',
        180000,
        120000,
        24000,
        6000,
        'unit',
      ],
      [
        'BEB-002',
        '7792798000128',
        'Agua mineral 500 ml',
        'Bebidas',
        90000,
        55000,
        30000,
        8000,
        'unit',
      ],
      ['BEB-003', null, 'Cerveza Quilmes 473 ml', 'Bebidas', 160000, 105000, 24000, 6000, 'unit'],
      ['GOLO-001', null, 'Alfajor de chocolate', 'Golosinas', 120000, 75000, 48000, 10000, 'unit'],
      [
        'GOLO-002',
        null,
        'Chocolate con leche 100 g',
        'Golosinas',
        250000,
        170000,
        12000,
        5000,
        'unit',
      ],
      ['ALM-001', null, 'Yerba mate 500 g', 'Almacén', 320000, 240000, 15000, 4000, 'unit'],
      ['ALM-002', null, 'Galletitas de chocolate', 'Almacén', 140000, 90000, 20000, 6000, 'unit'],
      ['ALM-003', null, 'Azúcar 1 kg', 'Almacén', 130000, 85000, 3000, 5000, 'unit'],
      [
        'SNK-001',
        null,
        'Papas fritas clásicas 90 g',
        'Snacks',
        210000,
        145000,
        18000,
        4000,
        'unit',
      ],
      ['SNK-002', null, 'Maní tostado a granel', 'Snacks', 850000, 550000, 5500, 2000, 'kg'],
      ['LIM-001', null, 'Detergente limón 500 ml', 'Limpieza', 190000, 130000, 2000, 4000, 'unit'],
      ['LACT-001', null, 'Leche entera 1 L', 'Lácteos', 180000, 125000, 12000, 6000, 'unit'],
    ];
    for (const [sku, barcode, name, category, price, cost, stock, min, unit] of products) {
      const {
        rows: [p],
      } = await db.query(
        'INSERT INTO products(tenant_id,sku,barcode,name,category,price_cents,cost_cents,min_stock_milli,unit,supplier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
        [tenant.id, sku, barcode, name, category, price, cost, min, unit, supplier.id],
      );
      await db.query(
        "INSERT INTO inventory_movements(tenant_id,product_id,user_id,qty_milli,kind,reason) VALUES($1,$2,$3,$4,'opening','Carga inicial de evaluación')",
        [tenant.id, p.id, owner.id, stock],
      );
    }
    await db.query(
      "INSERT INTO customers(tenant_id,name,contact,credit_limit_cents) VALUES($1,'Cliente de cuenta corriente','cliente@example.com',5000000)",
      [tenant.id],
    );
    await db.query('COMMIT');
    console.log(
      'Datos de evaluación creados. Comercio: modulab · Correo: admin@modulab.local · Contraseña: SEED_PASSWORD del entorno.',
    );
  }
} finally {
  await db.end();
}
