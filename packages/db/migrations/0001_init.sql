-- LedgerLens 0001: core schema. Money is BIGINT minor units; FX/percent use NUMERIC.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);

CREATE TABLE users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  sso_subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','disabled')),
  locale text NOT NULL DEFAULT 'he-IL' CHECK (locale IN ('he-IL','en-US')),
  UNIQUE (tenant_id, sso_subject)
);

CREATE TABLE memberships (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  user_id uuid NOT NULL REFERENCES users,
  role text NOT NULL CHECK (role IN ('cfo','fpa','controller','accountant','department_manager','admin')),
  entity_ids text[] NOT NULL DEFAULT '{}',          -- empty = no access (deny by default)
  department_ids text[] NOT NULL DEFAULT '{}',      -- '{*}' only when explicitly granted
  UNIQUE (tenant_id, user_id, role)
);

CREATE TABLE snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  kind text NOT NULL CHECK (kind IN ('actual','plan')),
  period_from text NOT NULL, period_to text NOT NULL,
  content_sha256 text NOT NULL,
  row_count integer NOT NULL,
  control_total_minor bigint,
  validation_status text NOT NULL CHECK (validation_status IN ('pending','failed','passed','published')),
  supersedes_snapshot_id uuid REFERENCES snapshots,
  uploaded_by uuid REFERENCES users,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, content_sha256)           -- idempotent re-import
);

CREATE TABLE ledger_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  snapshot_id uuid NOT NULL REFERENCES snapshots,
  source_row_id text NOT NULL,
  entity_id text NOT NULL, period text NOT NULL, posting_date date,
  account text NOT NULL, cost_center text, department text NOT NULL, manager_key text,
  amount_minor bigint NOT NULL, currency char(3) NOT NULL,
  document_ref text,
  UNIQUE (snapshot_id, source_row_id)
);

CREATE TABLE plan_versions (
  plan_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  type text NOT NULL CHECK (type IN ('budget','forecast')),
  name text NOT NULL, owner uuid REFERENCES users,
  state text NOT NULL CHECK (state IN ('draft','approved','superseded')),
  approved_at timestamptz, mapping_version text NOT NULL,
  base_currency char(3) NOT NULL, fx_policy_version text
);

CREATE TABLE plan_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  plan_version_id uuid NOT NULL REFERENCES plan_versions,
  source_row_id text NOT NULL,
  entity_id text NOT NULL, period text NOT NULL, account text NOT NULL,
  cost_center text, department text NOT NULL,
  amount_minor bigint NOT NULL, currency char(3) NOT NULL,
  UNIQUE (plan_version_id, source_row_id)
);

CREATE TABLE dimension_mappings (
  mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  version text NOT NULL, source_code text NOT NULL, canonical_id text NOT NULL,
  dimension text NOT NULL, label_he text, label_en text,
  effective_from date NOT NULL, approval_status text NOT NULL, owner uuid REFERENCES users,
  UNIQUE (tenant_id, version, dimension, source_code)
);

CREATE TABLE metric_definitions (
  metric_id text NOT NULL, version text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants,
  formula text NOT NULL, account_type text CHECK (account_type IN ('expense','revenue')),
  label_he text, label_en text, approval_status text NOT NULL,
  PRIMARY KEY (tenant_id, metric_id, version)
);

CREATE TABLE fx_rates (
  tenant_id uuid NOT NULL REFERENCES tenants,
  from_ccy char(3) NOT NULL, to_ccy char(3) NOT NULL,
  rate numeric(30,12) NOT NULL, effective_date date NOT NULL,
  rate_type text NOT NULL CHECK (rate_type IN ('transaction','average','closing')),
  source text NOT NULL, policy_version text NOT NULL,
  PRIMARY KEY (tenant_id, from_ccy, to_ccy, effective_date, rate_type)
);

CREATE TABLE close_periods (
  close_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  entity_id text NOT NULL, period text NOT NULL,
  snapshot_id uuid REFERENCES snapshots,
  state text NOT NULL CHECK (state IN ('open','ready','approved')) DEFAULT 'open',
  declared_ready_by uuid REFERENCES users, declared_ready_at timestamptz,
  UNIQUE (tenant_id, entity_id, period)
);

CREATE TABLE close_tasks (
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  close_id uuid NOT NULL REFERENCES close_periods,
  title text NOT NULL, owner uuid REFERENCES users, due_date date,
  status text NOT NULL CHECK (status IN ('todo','in_progress','blocked','done')) DEFAULT 'todo',
  evidence_ref text, reviewer uuid REFERENCES users
);

CREATE TABLE scenario_versions (
  scenario_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  owner uuid NOT NULL REFERENCES users,
  baseline_snapshot_id uuid REFERENCES snapshots, baseline_plan_version_id uuid REFERENCES plan_versions,
  revision integer NOT NULL DEFAULT 1,
  visibility text NOT NULL CHECK (visibility IN ('private','shared')) DEFAULT 'private',
  is_hypothetical boolean NOT NULL DEFAULT true CHECK (is_hypothetical)   -- never becomes actuals
);

CREATE TABLE scenario_levers (
  lever_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES scenario_versions,
  scope jsonb NOT NULL, kind text NOT NULL CHECK (kind IN ('pct','amount')),
  value_decimal numeric(20,6) NOT NULL
);

CREATE TABLE query_runs (
  query_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  caller uuid REFERENCES users, ast jsonb NOT NULL, ast_hash text NOT NULL,
  dataset_versions jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE metric_results (
  result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  query_run_id uuid NOT NULL REFERENCES query_runs,
  metric_id text NOT NULL, value_decimal numeric(40,12) NOT NULL,
  unit text NOT NULL, currency char(3), entity_ids text[] NOT NULL,
  period_start text NOT NULL, period_end text NOT NULL, filters jsonb NOT NULL,
  source_snapshot_ids uuid[] NOT NULL, plan_version_id uuid, mapping_version text NOT NULL,
  fx_policy_version text, formula_id text NOT NULL, as_of timestamptz NOT NULL,
  reconciliation_state text NOT NULL CHECK (reconciliation_state IN ('reconciled','unreconciled'))
);

CREATE TABLE lineage_links (
  result_id uuid NOT NULL REFERENCES metric_results,
  tenant_id uuid NOT NULL REFERENCES tenants,
  line_table text NOT NULL CHECK (line_table IN ('ledger_lines','plan_lines')),
  line_id uuid NOT NULL,
  PRIMARY KEY (result_id, line_table, line_id)
);

CREATE TABLE approval_requests (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  artifact_hash text NOT NULL,             -- exact version; any edit invalidates
  requested_by uuid NOT NULL REFERENCES users, approver uuid REFERENCES users,
  destination text NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','invalidated','expired')) DEFAULT 'pending',
  idempotency_key text NOT NULL, UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE outbox (   -- unused in MVP: no external send path
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  approval_id uuid NOT NULL REFERENCES approval_requests,
  status text NOT NULL DEFAULT 'disabled', external_id text
);

CREATE TABLE audit_events (
  event_id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL, at timestamptz NOT NULL DEFAULT now(),
  actor uuid, action text NOT NULL, object_ids text[] NOT NULL DEFAULT '{}',
  policy_decision text NOT NULL CHECK (policy_decision IN ('allow','deny')),
  input_hash text, output_hash text, tool_version text,
  correlation_id text NOT NULL, result text NOT NULL
);

-- Append-only: block UPDATE/DELETE on audit and on published snapshots' lines.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER plan_lines_immutable BEFORE UPDATE OR DELETE ON plan_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Row-level security: tenant comes from the session, never the client payload.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','memberships','snapshots','ledger_lines','plan_versions','plan_lines',
    'dimension_mappings','metric_definitions','fx_rates','close_periods','close_tasks','scenario_versions',
    'query_runs','metric_results','lineage_links','approval_requests','outbox','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
