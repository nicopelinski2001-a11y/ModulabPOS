CREATE TABLE payment_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), sale_id uuid NOT NULL,
 method text NOT NULL, user_id uuid NOT NULL, reference text NOT NULL CHECK(length(reference) BETWEEN 5 AND 160),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,sale_id,method),
 FOREIGN KEY(tenant_id,sale_id,method) REFERENCES sale_payments(tenant_id,sale_id,method),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
ALTER TABLE payment_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_confirmations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_confirmations USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payment_confirmations FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
