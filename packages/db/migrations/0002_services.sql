-- LedgerLens 0002: tables for import jobs, accounts, notes, results payload, close summaries, idempotency.
CREATE TABLE accounts (
  tenant_id uuid NOT NULL REFERENCES tenants,
  code text NOT NULL, type text NOT NULL CHECK (type IN ('expense','revenue')),
  label_he text NOT NULL, label_en text NOT NULL, mapping_version text NOT NULL,
  PRIMARY KEY (tenant_id, code)
);
CREATE TABLE departments (
  tenant_id uuid NOT NULL REFERENCES tenants,
  code text NOT NULL, label_he text NOT NULL, label_en text NOT NULL,
  PRIMARY KEY (tenant_id, code)
);
CREATE TABLE import_jobs (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  kind text NOT NULL CHECK (kind IN ('actual','plan')),
  filename text NOT NULL, content_sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('failed','passed','published')),
  rows jsonb NOT NULL, errors jsonb NOT NULL, control_total_minor bigint,
  periods text[] NOT NULL, plan_name text, created_by uuid REFERENCES users,
  published_ref uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notes (   -- approved explanatory notes; untrusted text, never instructions
  note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  period text NOT NULL, department text NOT NULL, body text NOT NULL, approved boolean NOT NULL DEFAULT false
);
CREATE TABLE close_summaries (
  summary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  close_id uuid NOT NULL REFERENCES close_periods,
  snapshot_id uuid NOT NULL REFERENCES snapshots,
  content jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES tenants, key text NOT NULL, response jsonb NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
ALTER TABLE metric_results ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE metric_results ADD COLUMN caller uuid;
ALTER TABLE approval_requests ADD COLUMN summary_id uuid REFERENCES close_summaries;
ALTER TABLE approval_requests ADD COLUMN approved_at timestamptz;
ALTER TABLE scenario_versions ADD COLUMN name text NOT NULL DEFAULT '';
ALTER TABLE scenario_levers ADD COLUMN tenant_id uuid REFERENCES tenants;
ALTER TABLE snapshots ADD COLUMN periods text[] NOT NULL DEFAULT '{}';

-- Auth lookup runs before the tenant is known, so it bypasses RLS in one narrow function.
CREATE FUNCTION auth_lookup(p_subject text) RETURNS TABLE(user_id uuid, tenant_id uuid, locale text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT u.user_id, u.tenant_id, u.locale FROM users u WHERE u.sso_subject = p_subject AND u.status = 'active' $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','departments','import_jobs','notes','close_summaries','idempotency_keys','scenario_levers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- Application role: no superuser, no BYPASSRLS, cannot touch audit history.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN PASSWORD 'ledger_app_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ledger_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
REVOKE UPDATE ON audit_events, ledger_lines, plan_lines FROM ledger_app;
GRANT EXECUTE ON FUNCTION auth_lookup(text) TO ledger_app;
