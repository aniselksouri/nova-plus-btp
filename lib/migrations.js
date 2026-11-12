"use strict";

// Migrations SQL versionnées. Ne jamais modifier une migration déjà déployée :
// en ajouter une nouvelle à la fin. Aucun nom de schéma n'est écrit en dur, pour pouvoir
// rejouer le schéma dans un schéma temporaire lors des tests de restauration.

const MIGRATIONS = [
  {
    id: "001_socle",
    sql: `
CREATE TABLE IF NOT EXISTS meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'direction_commerciale', 'commercial', 'secretariat')),
  commission_rate numeric(5, 2),
  active boolean NOT NULL DEFAULT true,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  totp_pending_secret text,
  totp_last_step bigint,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_verified boolean NOT NULL DEFAULT false,
  mfa_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  user_label text,
  action text NOT NULL,
  entity text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);

-- Données de l'application actuelle (chantiers, lots, factures...) : un document versionné.
-- Les modules Nova+ 2.0 (devis, bibliothèque, ST...) auront leurs propres tables.
CREATE TABLE IF NOT EXISTS app_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_state_history (
  id bigserial PRIMARY KEY,
  version integer NOT NULL,
  data jsonb NOT NULL,
  projects_count integer NOT NULL DEFAULT 0,
  size_bytes integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'save',
  saved_at timestamptz NOT NULL DEFAULT now(),
  saved_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS app_state_history_saved_idx ON app_state_history (saved_at DESC);

-- Enregistrements refusés (conflit entre deux postes, suppression massive) : jamais perdus.
CREATE TABLE IF NOT EXISTS state_rejections (
  id bigserial PRIMARY KEY,
  reason text NOT NULL,
  base_version integer,
  current_version integer,
  data jsonb NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'upload'
);
`,
  },
  {
    id: "002_produit_btp",
    sql: `
-- Rôles standards d'une entreprise du BTP (Nova+ est commercialisé à plusieurs entreprises).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'direction_commerciale', 'commercial', 'conducteur_travaux', 'secretariat', 'comptabilite'));

-- Profil de l'entreprise utilisatrice : identité, mentions légales, réglages par défaut.
CREATE TABLE IF NOT EXISTS company_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
`,
  },
  {
    id: "003_devis_v1",
    sql: `
-- Compteurs de numérotation (devis par année, bons de commande...).
CREATE TABLE IF NOT EXISTS sequences (
  key text PRIMARY KEY,
  value integer NOT NULL DEFAULT 0
);

-- ---------- Bibliothèque d'ouvrages ----------
CREATE TABLE IF NOT EXISTS library_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  labor_margin numeric(5, 2),
  supply_margin numeric(5, 2),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  lot_id uuid NOT NULL REFERENCES library_lots(id),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'u',
  labor_cost numeric(12, 2),
  labor_margin numeric(5, 2),
  supplier text NOT NULL DEFAULT '',
  supplier_ref text NOT NULL DEFAULT '',
  supply_public_price numeric(12, 2),
  supply_pro_price numeric(12, 2),
  supply_margin numeric(5, 2),
  vat_rate numeric(4, 2),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_items_lot_idx ON library_items (lot_id);

-- ---------- Sous-traitants, documents, grilles de prix ----------
CREATE TABLE IF NOT EXISTS subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  name text NOT NULL,
  siret text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  lots text[] NOT NULL DEFAULT '{}',
  contact_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subcontractor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('decennale', 'kbis', 'urssaf', 'rc_pro', 'autre')),
  label text NOT NULL DEFAULT '',
  file_key text,
  expires_on date,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS subcontractor_documents_st_idx ON subcontractor_documents (subcontractor_id);

CREATE TABLE IF NOT EXISTS price_grids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id),
  version integer NOT NULL DEFAULT 1,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'replaced')),
  sent_at timestamptz,
  signed_at timestamptz,
  signed_file_key text,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS price_grids_st_idx ON price_grids (subcontractor_id);

CREATE TABLE IF NOT EXISTS price_grid_lines (
  grid_id uuid NOT NULL REFERENCES price_grids(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES library_items(id),
  labor_price numeric(12, 2) NOT NULL,
  supply_included boolean NOT NULL DEFAULT false,
  supply_price numeric(12, 2),
  PRIMARY KEY (grid_id, item_id)
);

-- ---------- Dossiers clients, devis, avenants ----------
CREATE TABLE IF NOT EXISTS dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  client_email text NOT NULL DEFAULT '',
  client_phone text NOT NULL DEFAULT '',
  client_address text NOT NULL DEFAULT '',
  site_address text NOT NULL DEFAULT '',
  -- Contrat conclu hors établissement (chez le client) : rétractation 14 jours.
  off_premises boolean NOT NULL DEFAULT false,
  commercial_id uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id text,
  notes text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id),
  number text NOT NULL,
  amendment_no integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'refused', 'superseded')),
  title text NOT NULL DEFAULT '',
  commercial_id uuid REFERENCES users(id) ON DELETE SET NULL,
  commission_rate numeric(5, 2),
  schedule jsonb NOT NULL,
  schedule_mode text NOT NULL DEFAULT 'separate' CHECK (schedule_mode IN ('separate', 'merge')),
  valid_days integer NOT NULL DEFAULT 30,
  work_start_on date,
  notes text NOT NULL DEFAULT '',
  totals jsonb,
  sent_at timestamptz,
  signed_at timestamptz,
  refused_at timestamptz,
  refusal_reason text,
  signature jsonb,
  signed_file_key text,
  early_start_requested boolean NOT NULL DEFAULT false,
  withdrawal_until date,
  forced_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (number, amendment_no, version)
);
CREATE INDEX IF NOT EXISTS quotes_dossier_idx ON quotes (dossier_id);
CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_signed_idx ON quotes (number, amendment_no) WHERE status = 'signed';

CREATE TABLE IF NOT EXISTS quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position integer NOT NULL,
  item_id uuid REFERENCES library_items(id) ON DELETE SET NULL,
  code text NOT NULL DEFAULT '',
  lot_name text NOT NULL DEFAULT 'Divers',
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'u',
  quantity numeric(12, 3) NOT NULL DEFAULT 1,
  mode text NOT NULL DEFAULT 'both' CHECK (mode IN ('both', 'labor', 'supply')),
  subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL,
  st_scope text NOT NULL DEFAULT 'labor' CHECK (st_scope IN ('none', 'labor', 'supply', 'both')),
  grid_id uuid REFERENCES price_grids(id) ON DELETE SET NULL,
  grid_labor_cost numeric(12, 2),
  grid_ends_on date,
  labor_cost numeric(12, 2),
  labor_cost_source text NOT NULL DEFAULT 'grid' CHECK (labor_cost_source IN ('grid', 'manual')),
  labor_margin numeric(5, 2),
  labor_price_override numeric(12, 2),
  supply_pro_cost numeric(12, 2),
  supply_public_price numeric(12, 2),
  supply_pricing text NOT NULL DEFAULT 'auto' CHECK (supply_pricing IN ('auto', 'public', 'margin')),
  supply_margin numeric(5, 2),
  supply_price_override numeric(12, 2),
  supplier text NOT NULL DEFAULT '',
  vat_rate numeric(4, 2) NOT NULL DEFAULT 20,
  exception_reason text NOT NULL DEFAULT '',
  forced boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS quote_lines_quote_idx ON quote_lines (quote_id, position);

-- ---------- Bons de commande sous-traitants ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id),
  number text NOT NULL UNIQUE,
  lines jsonb NOT NULL,
  schedule jsonb NOT NULL,
  total numeric(12, 2) NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'blocked', 'sent', 'signed', 'cancelled')),
  blocked_reason text,
  sent_at timestamptz,
  signed_at timestamptz,
  signed_file_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, subcontractor_id)
);

-- ---------- Envois et signatures (historique par document) ----------
CREATE TABLE IF NOT EXISTS signature_events (
  id bigserial PRIMARY KEY,
  document_type text NOT NULL CHECK (document_type IN ('quote', 'grid', 'purchase_order', 'reception')),
  document_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('generated', 'sent', 'opened', 'signed', 'refused', 'reminder', 'uploaded')),
  recipient text,
  method text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_sha256 text,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ip text
);
CREATE INDEX IF NOT EXISTS signature_events_doc_idx ON signature_events (document_type, document_id, at);

-- ---------- PV de réception (déclenche le solde) ----------
CREATE TABLE IF NOT EXISTS receptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossiers(id),
  received_on date NOT NULL,
  reserves jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  signature jsonb,
  signed_file_key text,
  signed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: "004_crm_v2",
    sql: `
-- Réglages du CRM (tour de rôle, délais de relance par colonne, motifs de perte, bénéfice visé).
CREATE TABLE IF NOT EXISTS crm_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Leads (module 5) ----------
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('meta', 'google', 'website', 'phone', 'manual', 'other')),
  external_id text,
  campaign text,
  campaign_id text,
  ad_name text,
  form_name text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  name text NOT NULL DEFAULT '',
  phone text,
  email text,
  postal_code text,
  city text,
  address text,
  need text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'visit', 'quote_sent', 'negotiation', 'won', 'lost')),
  lost_reason text,
  commercial_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  dossier_id uuid REFERENCES dossiers(id) ON DELETE SET NULL,
  duplicate_of uuid,
  is_test boolean NOT NULL DEFAULT false,
  incomplete boolean NOT NULL DEFAULT false,
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  won_at timestamptz,
  lost_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS leads_stage_idx ON leads (stage, stage_changed_at);
CREATE INDEX IF NOT EXISTS leads_commercial_idx ON leads (commercial_id, received_at);
CREATE INDEX IF NOT EXISTS leads_dossier_idx ON leads (dossier_id);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (lower(email));

-- Historique : appels, visites, notes, changements de colonne, devis liés.
CREATE TABLE IF NOT EXISTS lead_events (
  id bigserial PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('created', 'stage', 'assigned', 'call', 'visit', 'note', 'email', 'quote', 'task', 'duplicate', 'update')),
  body text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events (lead_id, at);

-- Tâches et rappels (relances).
CREATE TABLE IF NOT EXISTS lead_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  done_at timestamptz,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  auto boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_tasks_due_idx ON lead_tasks (done_at, due_at);

-- ---------- Point mort et objectifs ----------
CREATE TABLE IF NOT EXISTS fixed_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  label text NOT NULL,
  monthly_amount numeric(12, 2) NOT NULL CHECK (monthly_amount >= 0),
  active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Objectif de CA signé HT : par commercial (user_id) ou équipe (user_id NULL), mensuel (AAAA-MM) ou annuel (AAAA).
CREATE TABLE IF NOT EXISTS sales_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}(-[0-9]{2})?$'),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_objectives_unique ON sales_objectives (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), period);

-- Paliers de motivation (primes) paramétrés par la direction.
CREATE TABLE IF NOT EXISTS bonus_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  period_kind text NOT NULL DEFAULT 'month' CHECK (period_kind IN ('month', 'year')),
  threshold numeric(12, 2) NOT NULL CHECK (threshold >= 0),
  reward text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];

async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await db.query("SELECT id FROM schema_migrations")).map((row) => row.id));
  const applied = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    await db.tx(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    });
    applied.push(migration.id);
  }
  return applied;
}

// Rejoue le schéma complet dans la transaction en cours (search_path déjà positionné).
async function applySchemaInTransaction(tx) {
  await tx.exec(`CREATE TABLE schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const migration of MIGRATIONS) {
    await tx.exec(migration.sql);
    await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
  }
}

const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;

module.exports = { MIGRATIONS, SCHEMA_VERSION, migrate, applySchemaInTransaction };
