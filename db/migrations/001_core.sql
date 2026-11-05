CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9-]{3,50}$'),
 name text NOT NULL, address text NOT NULL DEFAULT '', tax_id text NOT NULL DEFAULT '',
 timezone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires', allow_negative_stock boolean NOT NULL DEFAULT false,
 paper_width integer NOT NULL DEFAULT 80 CHECK(paper_width IN (58,80)), next_sale_number bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL, email text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','admin','cashier','stock')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,email)
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE branches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE cash_registers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, name text NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE cash_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), register_id uuid NOT NULL,
 user_id uuid NOT NULL, opening_cents bigint NOT NULL CHECK(opening_cents BETWEEN 0 AND 1000000000000),
 opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, counted_cents bigint CHECK(counted_cents BETWEEN 0 AND 1000000000000),
 expected_cents bigint, close_reason text,
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,register_id) REFERENCES cash_registers(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
 CHECK((closed_at IS NULL AND counted_cents IS NULL) OR (closed_at IS NOT NULL AND counted_cents IS NOT NULL AND expected_cents IS NOT NULL))
);
CREATE UNIQUE INDEX one_shift_per_register ON cash_shifts(tenant_id,register_id) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX one_shift_per_user ON cash_shifts(tenant_id,user_id) WHERE closed_at IS NULL;
CREATE TABLE suppliers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
 contact text NOT NULL DEFAULT '', tax_id text NOT NULL DEFAULT '', UNIQUE(tenant_id,id)
);
CREATE TABLE products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), sku text NOT NULL,
 barcode text, name text NOT NULL, description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'General', brand text NOT NULL DEFAULT '',
 supplier_id uuid, unit text NOT NULL DEFAULT 'unit' CHECK(unit IN ('unit','kg')),
 price_cents bigint NOT NULL CHECK(price_cents BETWEEN 1 AND 1000000000), cost_cents bigint NOT NULL DEFAULT 0 CHECK(cost_cents BETWEEN 0 AND 1000000000),
 stock_milli bigint NOT NULL DEFAULT 0 CHECK(stock_milli BETWEEN -1000000000000 AND 1000000000000),
 min_stock_milli bigint NOT NULL DEFAULT 0 CHECK(min_stock_milli BETWEEN 0 AND 1000000000), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,sku), UNIQUE(tenant_id,barcode), FOREIGN KEY(tenant_id,supplier_id) REFERENCES suppliers(tenant_id,id)
);
CREATE INDEX products_search ON products(tenant_id,lower(name));
CREATE INDEX products_category ON products(tenant_id,category);
CREATE TABLE customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
 contact text NOT NULL DEFAULT '', tax_id text NOT NULL DEFAULT '', credit_limit_cents bigint NOT NULL DEFAULT 0 CHECK(credit_limit_cents BETWEEN 0 AND 1000000000000),
 UNIQUE(tenant_id,id)
);
CREATE TABLE sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), number bigint NOT NULL,
 shift_id uuid NOT NULL, user_id uuid NOT NULL, customer_id uuid, idempotency_key uuid NOT NULL, request_hash text NOT NULL,
 subtotal_cents bigint NOT NULL CHECK(subtotal_cents > 0), discount_cents bigint NOT NULL CHECK(discount_cents >= 0),
 total_cents bigint NOT NULL CHECK(total_cents BETWEEN 1 AND 1000000000000), change_cents bigint NOT NULL CHECK(change_cents >= 0),
 receipt_settings jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(total_cents=subtotal_cents-discount_cents), UNIQUE(tenant_id,id), UNIQUE(tenant_id,number), UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,shift_id) REFERENCES cash_shifts(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE INDEX sales_date ON sales(tenant_id,created_at DESC);
CREATE TABLE sale_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), sale_id uuid NOT NULL, product_id uuid NOT NULL,
 name text NOT NULL, sku text NOT NULL, unit text NOT NULL, qty_milli bigint NOT NULL CHECK(qty_milli BETWEEN 1 AND 1000000000),
 price_cents bigint NOT NULL, cost_cents bigint NOT NULL, total_cents bigint NOT NULL,
 UNIQUE(tenant_id,sale_id,product_id), FOREIGN KEY(tenant_id,sale_id) REFERENCES sales(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE sale_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), sale_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','transfer','debit','credit','wallet','account')),
 status text NOT NULL CHECK(status IN ('manual','pending')), amount_cents bigint NOT NULL CHECK(amount_cents > 0),
 tendered_cents bigint NOT NULL CHECK(tendered_cents >= amount_cents),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES sales(tenant_id,id), UNIQUE(tenant_id,sale_id,method)
);
CREATE TABLE sale_returns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), sale_id uuid NOT NULL,
 shift_id uuid NOT NULL, user_id uuid NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,sale_id), FOREIGN KEY(tenant_id,sale_id) REFERENCES sales(tenant_id,id), FOREIGN KEY(tenant_id,shift_id) REFERENCES cash_shifts(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE cash_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), shift_id uuid NOT NULL, user_id uuid NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents <> 0 AND amount_cents BETWEEN -1000000000000 AND 1000000000000),
 kind text NOT NULL CHECK(kind IN ('sale','return','in','out','collection','supplier_payment')),
 reference_id uuid, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,shift_id) REFERENCES cash_shifts(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE purchases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), supplier_id uuid NOT NULL,
 user_id uuid NOT NULL, reference text NOT NULL, total_cents bigint NOT NULL CHECK(total_cents BETWEEN 1 AND 1000000000000),
 status text NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','received')), created_at timestamptz NOT NULL DEFAULT now(), received_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,supplier_id,reference), FOREIGN KEY(tenant_id,supplier_id) REFERENCES suppliers(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE purchase_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), purchase_id uuid NOT NULL, product_id uuid NOT NULL,
 qty_milli bigint NOT NULL CHECK(qty_milli BETWEEN 1 AND 1000000000), cost_cents bigint NOT NULL CHECK(cost_cents BETWEEN 1 AND 1000000000), total_cents bigint NOT NULL,
 UNIQUE(tenant_id,purchase_id,product_id), FOREIGN KEY(tenant_id,purchase_id) REFERENCES purchases(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE supplier_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), purchase_id uuid NOT NULL, user_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000000000),
 method text NOT NULL CHECK(method IN ('cash','transfer')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,idempotency_key), FOREIGN KEY(tenant_id,purchase_id) REFERENCES purchases(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE inventory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), product_id uuid NOT NULL, user_id uuid NOT NULL,
 qty_milli bigint NOT NULL CHECK(qty_milli <> 0 AND qty_milli BETWEEN -1000000000 AND 1000000000),
 kind text NOT NULL CHECK(kind IN ('opening','sale','return','adjustment','purchase')), reference_id uuid, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX inventory_product ON inventory_movements(tenant_id,product_id,created_at DESC);
CREATE TABLE customer_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL, user_id uuid NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents <> 0 AND amount_cents BETWEEN -1000000000000 AND 1000000000000),
 kind text NOT NULL CHECK(kind IN ('sale','return','payment')), reference_id uuid, idempotency_key uuid, method text,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,idempotency_key), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE held_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL,
 label text NOT NULL, items jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid,
 action text NOT NULL, entity_id uuid, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX audit_date ON audit_events(tenant_id,created_at DESC);
-- Ledger immutability applies even to accidental application SQL.
CREATE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historial inmutable: crear movimiento compensatorio' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sales','sale_lines','sale_payments','sale_returns','cash_movements','inventory_movements','customer_movements','supplier_payments','audit_events','purchase_lines'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_ledger()', t);
 END LOOP;
END $$;
CREATE FUNCTION apply_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE allow_negative boolean; new_stock bigint;
BEGIN
 IF NEW.tenant_id::text IS DISTINCT FROM current_setting('app.tenant_id',true) THEN RAISE EXCEPTION 'Tenant inválido'; END IF;
 SELECT allow_negative_stock INTO allow_negative FROM public.tenants WHERE id=NEW.tenant_id;
 UPDATE public.products SET stock_milli=stock_milli+NEW.qty_milli,updated_at=now() WHERE tenant_id=NEW.tenant_id AND id=NEW.product_id RETURNING stock_milli INTO new_stock;
 IF new_stock < 0 AND NOT allow_negative THEN RAISE EXCEPTION 'Stock insuficiente' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_balance AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION apply_inventory();
-- Every tenant-owned table is denied without transaction-local context.
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('login_attempts','tenants') LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid)',t);
 END LOOP;
END $$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants USING(id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(id=nullif(current_setting('app.tenant_id',true),'')::uuid);
-- Three tightly scoped bootstrap functions are the sole cross-tenant auth access.
CREATE FUNCTION auth_lookup(p_slug text,p_email text) RETURNS TABLE(user_id uuid,tenant_id uuid,password_hash text,active boolean) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id,u.tenant_id,u.password_hash,u.active FROM public.users u JOIN public.tenants t ON t.id=u.tenant_id WHERE t.slug=p_slug AND u.email=p_email
$$;
CREATE FUNCTION session_lookup(p_hash text) RETURNS TABLE(user_id uuid,tenant_id uuid,session_id uuid,name text,email text,role text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id,u.tenant_id,s.id,u.name,u.email,u.role FROM public.sessions s JOIN public.users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id WHERE s.token_hash=p_hash AND s.expires_at>now() AND u.active
$$;
CREATE FUNCTION login_gate(p_key text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 INSERT INTO public.login_attempts AS a(key,attempts,reset_at) VALUES(p_key,1,now()+interval '15 minutes')
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN a.reset_at<now() THEN 1 ELSE a.attempts+1 END,reset_at=CASE WHEN a.reset_at<now() THEN now()+interval '15 minutes' ELSE a.reset_at END RETURNING attempts<=10
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
CREATE UNIQUE INDEX inventory_reference ON inventory_movements(tenant_id,kind,reference_id,product_id) WHERE reference_id IS NOT NULL;
CREATE UNIQUE INDEX cash_reference ON cash_movements(tenant_id,kind,reference_id) WHERE reference_id IS NOT NULL;
