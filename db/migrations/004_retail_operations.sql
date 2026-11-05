ALTER TABLE tenants
 ADD COLUMN currency text NOT NULL DEFAULT 'ARS' CHECK(currency='ARS'),
 ADD COLUMN tax_rate_bps integer NOT NULL DEFAULT 0 CHECK(tax_rate_bps BETWEEN 0 AND 10000),
 ADD COLUMN receipt_footer text NOT NULL DEFAULT '¡Gracias por tu compra!' CHECK(length(receipt_footer)<=300),
 ADD COLUMN session_idle_minutes integer NOT NULL DEFAULT 15 CHECK(session_idle_minutes BETWEEN 1 AND 120);
ALTER TABLE products ADD COLUMN tax_rate_bps integer CHECK(tax_rate_bps BETWEEN 0 AND 10000);
ALTER TABLE sessions ADD COLUMN last_active_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION session_lookup(p_hash text) RETURNS TABLE(user_id uuid,tenant_id uuid,session_id uuid,name text,email text,role text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id,u.tenant_id,s.id,u.name,u.email,u.role FROM public.sessions s
 JOIN public.users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id
 JOIN public.tenants t ON t.id=s.tenant_id
 WHERE s.token_hash=p_hash AND s.expires_at>now() AND u.active
 AND s.last_active_at>now()-make_interval(mins=>t.session_idle_minutes)
$$;
ALTER TABLE sales ADD COLUMN tax_cents bigint NOT NULL DEFAULT 0 CHECK(tax_cents BETWEEN 0 AND total_cents);
ALTER TABLE sale_lines
 ADD COLUMN tax_rate_bps integer NOT NULL DEFAULT 0 CHECK(tax_rate_bps BETWEEN 0 AND 10000),
 ADD COLUMN discount_cents bigint NOT NULL DEFAULT 0 CHECK(discount_cents BETWEEN 0 AND total_cents),
 ADD COLUMN tax_cents bigint NOT NULL DEFAULT 0 CHECK(tax_cents>=0);
ALTER TABLE sale_lines ADD CONSTRAINT included_tax_amount CHECK(
 tax_cents=((total_cents-discount_cents)*tax_rate_bps+(10000+tax_rate_bps)/2)/(10000+tax_rate_bps)
);
-- Existing receipts predate tax allocation and must stay immutable.
CREATE FUNCTION check_sale_tax() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE discounts bigint; taxes bigint; change bigint;
BEGIN
 SELECT coalesce(sum(discount_cents),0),coalesce(sum(tax_cents),0) INTO discounts,taxes FROM public.sale_lines WHERE sale_id=NEW.id AND tenant_id=NEW.tenant_id;
 SELECT coalesce(sum(tendered_cents-amount_cents),0) INTO change FROM public.sale_payments WHERE sale_id=NEW.id AND tenant_id=NEW.tenant_id;
 IF discounts<>NEW.discount_cents OR taxes<>NEW.tax_cents OR change<>NEW.change_cents THEN
 RAISE EXCEPTION 'Descuento, impuesto o vuelto inconsistente' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sale_tax AFTER INSERT ON sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_sale_tax();
CREATE INDEX cash_movements_shift_date ON cash_movements(tenant_id,shift_id,created_at);
CREATE INDEX cash_shifts_date ON cash_shifts(tenant_id,opened_at DESC);
CREATE INDEX sale_lines_sale ON sale_lines(tenant_id,sale_id);
CREATE INDEX sale_payments_sale ON sale_payments(tenant_id,sale_id);
CREATE INDEX customer_ledger ON customer_movements(tenant_id,customer_id,created_at);
CREATE INDEX returns_date ON sale_returns(tenant_id,created_at);
CREATE INDEX sales_shift ON sales(tenant_id,shift_id);
CREATE INDEX low_stock ON products(tenant_id,stock_milli) WHERE active AND stock_milli<=min_stock_milli;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
