-- Commit-time checks prevent even an incomplete application transaction from posting a partial sale.
ALTER TABLE sale_lines ADD CONSTRAINT sale_line_amounts CHECK(
 price_cents BETWEEN 1 AND 1000000000 AND cost_cents BETWEEN 0 AND 1000000000
 AND total_cents=(price_cents*qty_milli+500)/1000 AND total_cents>0
 AND (unit='kg' OR (unit='unit' AND qty_milli%1000=0))
);
ALTER TABLE sale_payments ADD CONSTRAINT payment_tender CHECK(
 (method='cash' AND status='manual') OR (method='account' AND status='manual' AND tendered_cents=amount_cents)
 OR (method NOT IN ('cash','account') AND tendered_cents=amount_cents)
);
ALTER TABLE purchase_lines ADD CONSTRAINT purchase_line_amounts CHECK(total_cents=(cost_cents*qty_milli+500)/1000 AND total_cents>0);
CREATE FUNCTION check_sale_posting() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE lines bigint; payments bigint; cash bigint; account bigint; actual bigint;
BEGIN
 SELECT coalesce(sum(total_cents),0) INTO lines FROM public.sale_lines WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.id;
 SELECT coalesce(sum(amount_cents),0),coalesce(sum(amount_cents) FILTER(WHERE method='cash'),0),coalesce(sum(amount_cents) FILTER(WHERE method='account'),0)
 INTO payments,cash,account FROM public.sale_payments WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.id;
 IF lines<>NEW.subtotal_cents OR payments<>NEW.total_cents THEN RAISE EXCEPTION 'Asiento de venta incompleto' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO actual FROM public.cash_movements WHERE tenant_id=NEW.tenant_id AND reference_id=NEW.id AND kind='sale' AND shift_id=NEW.shift_id;
 IF actual<>cash THEN RAISE EXCEPTION 'Caja de venta inconsistente' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO actual FROM public.customer_movements WHERE tenant_id=NEW.tenant_id AND reference_id=NEW.id AND kind='sale' AND customer_id=NEW.customer_id;
 IF actual<>account THEN RAISE EXCEPTION 'Cuenta de venta inconsistente' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lines l WHERE l.tenant_id=NEW.tenant_id AND l.sale_id=NEW.id AND NOT EXISTS(
   SELECT 1 FROM public.inventory_movements m WHERE m.tenant_id=l.tenant_id AND m.reference_id=l.sale_id AND m.product_id=l.product_id AND m.kind='sale' AND m.qty_milli=-l.qty_milli))
 THEN RAISE EXCEPTION 'Inventario de venta inconsistente' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sale_posting AFTER INSERT ON sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_sale_posting();
CREATE FUNCTION check_return_posting() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE cash bigint; account bigint; actual bigint;
BEGIN
 SELECT coalesce(sum(amount_cents) FILTER(WHERE method='cash'),0),coalesce(sum(amount_cents) FILTER(WHERE method='account'),0)
 INTO cash,account FROM public.sale_payments WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id;
 SELECT coalesce(sum(amount_cents),0) INTO actual FROM public.cash_movements WHERE tenant_id=NEW.tenant_id AND reference_id=NEW.sale_id AND kind='return' AND shift_id=NEW.shift_id;
 IF actual<>-cash THEN RAISE EXCEPTION 'Caja de devolución inconsistente' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO actual FROM public.customer_movements WHERE tenant_id=NEW.tenant_id AND reference_id=NEW.sale_id AND kind='return';
 IF actual<>-account THEN RAISE EXCEPTION 'Cuenta de devolución inconsistente' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lines l WHERE l.tenant_id=NEW.tenant_id AND l.sale_id=NEW.sale_id AND NOT EXISTS(
   SELECT 1 FROM public.inventory_movements m WHERE m.tenant_id=l.tenant_id AND m.reference_id=l.sale_id AND m.product_id=l.product_id AND m.kind='return' AND m.qty_milli=l.qty_milli))
 THEN RAISE EXCEPTION 'Inventario de devolución inconsistente' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER return_posting AFTER INSERT ON sale_returns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_return_posting();
CREATE FUNCTION guard_shift_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.closed_at IS NOT NULL OR NEW.tenant_id<>OLD.tenant_id OR NEW.register_id<>OLD.register_id OR NEW.user_id<>OLD.user_id OR NEW.opened_at<>OLD.opened_at OR NEW.opening_cents<>OLD.opening_cents OR NEW.closed_at IS NULL
 THEN RAISE EXCEPTION 'El turno sólo admite un cierre definitivo' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shift_history BEFORE UPDATE ON cash_shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_update();
CREATE FUNCTION check_purchase_posting() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE lines bigint;
BEGIN
 SELECT coalesce(sum(total_cents),0) INTO lines FROM public.purchase_lines WHERE tenant_id=NEW.tenant_id AND purchase_id=NEW.id;
 IF lines<>NEW.total_cents THEN RAISE EXCEPTION 'Compra incompleta' USING ERRCODE='23514'; END IF;
 IF NEW.status='received' AND (NEW.received_at IS NULL OR EXISTS(SELECT 1 FROM public.purchase_lines l WHERE l.tenant_id=NEW.tenant_id AND l.purchase_id=NEW.id AND NOT EXISTS(
  SELECT 1 FROM public.inventory_movements m WHERE m.tenant_id=l.tenant_id AND m.reference_id=l.purchase_id AND m.product_id=l.product_id AND m.kind='purchase' AND m.qty_milli=l.qty_milli)))
 THEN RAISE EXCEPTION 'Recepción inconsistente' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER purchase_posting AFTER INSERT OR UPDATE ON purchases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_purchase_posting();
CREATE FUNCTION guard_purchase_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'ordered' OR NEW.status<>'received' OR NEW.tenant_id<>OLD.tenant_id OR NEW.supplier_id<>OLD.supplier_id OR NEW.user_id<>OLD.user_id OR NEW.reference<>OLD.reference OR NEW.total_cents<>OLD.total_cents OR NEW.created_at<>OLD.created_at
 THEN RAISE EXCEPTION 'La compra sólo admite recepción definitiva' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_history BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION guard_purchase_update();
CREATE FUNCTION guard_inventory_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.qty_milli%1000<>0 AND EXISTS(SELECT 1 FROM public.products WHERE tenant_id=NEW.tenant_id AND id=NEW.product_id AND unit='unit')
 THEN RAISE EXCEPTION 'El producto requiere unidades enteras' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_unit BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION guard_inventory_unit();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
