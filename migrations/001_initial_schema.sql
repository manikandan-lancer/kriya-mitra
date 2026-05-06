-- =====================================================================
-- Kriya Mitra: initial schema
-- =====================================================================
-- PostGIS is intentionally NOT used here so this runs on the pgvector
-- image. For Phase 2 (geo dealer routing) swap dealers.lat/lng for a
-- GEOGRAPHY column and add a GIST index.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------- Farmers ----------
CREATE TABLE farmers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whatsapp_number TEXT UNIQUE NOT NULL,
  name            TEXT,
  preferred_lang  TEXT CHECK (preferred_lang IN ('ta','hi','en','te','kn','mr','bn')),
  state           TEXT,
  district        TEXT,
  pincode         TEXT,
  farm_size_acres NUMERIC,
  consent_given   BOOLEAN DEFAULT FALSE,
  consent_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_farmers_district ON farmers (state, district);

-- ---------- Crops ----------
CREATE TABLE crops (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT UNIQUE NOT NULL,
  name_en     TEXT NOT NULL,
  name_local  JSONB NOT NULL DEFAULT '{}'::jsonb,
  scientific  TEXT,
  category    TEXT
);

CREATE TABLE farmer_crops (
  farmer_id UUID REFERENCES farmers(id) ON DELETE CASCADE,
  crop_id   UUID REFERENCES crops(id) ON DELETE CASCADE,
  PRIMARY KEY (farmer_id, crop_id)
);

-- ---------- Disease KB ----------
CREATE TABLE crop_issues (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crop_id     UUID REFERENCES crops(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  type        TEXT CHECK (type IN ('pest','disease','deficiency','stress')),
  name_en     TEXT NOT NULL,
  name_local  JSONB NOT NULL DEFAULT '{}'::jsonb,
  scientific  TEXT,
  symptoms    TEXT[] NOT NULL DEFAULT '{}',
  severity    TEXT CHECK (severity IN ('low','medium','high','critical')),
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (crop_id, slug)
);
CREATE INDEX idx_crop_issues_embedding ON crop_issues
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ---------- Images ----------
CREATE TABLE images (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmer_id       UUID REFERENCES farmers(id) ON DELETE SET NULL,
  conversation_id UUID,
  s3_key          TEXT NOT NULL,
  content_type    TEXT,
  width           INT,
  height          INT,
  taken_at        TIMESTAMPTZ,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Products ----------
CREATE TABLE products (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku                TEXT UNIQUE NOT NULL,
  name               TEXT NOT NULL,
  category           TEXT,
  description        JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_ingredients TEXT[] NOT NULL DEFAULT '{}',
  certifications     TEXT[] NOT NULL DEFAULT '{}',
  image_urls         TEXT[] NOT NULL DEFAULT '{}',
  msrp               NUMERIC,
  pack_sizes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Product recommendations (the source of truth for the bot) ----------
-- Bot ONLY serves rows where approved_by IS NOT NULL AND is_active = TRUE.
-- Dosage / frequency / precautions are never modified by the LLM.
CREATE TABLE product_recommendations (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id                 UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  crop_issue_id              UUID NOT NULL REFERENCES crop_issues(id) ON DELETE CASCADE,
  dosage                     TEXT NOT NULL,
  application                TEXT NOT NULL,
  frequency                  TEXT NOT NULL,
  pre_harvest_interval_days  INT,
  precautions                TEXT[] NOT NULL DEFAULT '{}',
  notes                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  rank                       INT NOT NULL DEFAULT 100,
  approved_by                TEXT,
  approved_at                TIMESTAMPTZ,
  is_active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, crop_issue_id)
);
CREATE INDEX idx_recs_lookup ON product_recommendations (crop_issue_id, is_active, approved_by);

-- ---------- Conversations ----------
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmer_id   UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','escalated')),
  state       TEXT NOT NULL DEFAULT 'NEW',
  context     JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ
);
CREATE INDEX idx_conv_farmer_active ON conversations (farmer_id) WHERE status = 'active';

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  whatsapp_message_id TEXT UNIQUE,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender          TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  text            TEXT,
  media_id        UUID REFERENCES images(id) ON DELETE SET NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conv ON messages (conversation_id, created_at);

-- ---------- Diagnoses ----------
CREATE TABLE diagnoses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmer_id       UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  image_id        UUID REFERENCES images(id) ON DELETE SET NULL,
  crop_id         UUID REFERENCES crops(id) ON DELETE SET NULL,
  candidates      JSONB NOT NULL,
  top_issue_id    UUID REFERENCES crop_issues(id) ON DELETE SET NULL,
  top_confidence  NUMERIC,
  severity_hint   TEXT,
  model_name      TEXT,
  model_version   TEXT,
  reasoning       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_diagnoses_farmer ON diagnoses (farmer_id, created_at DESC);

-- ---------- Dealers ----------
CREATE TABLE dealers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  phone            TEXT,
  whatsapp_number  TEXT,
  address          TEXT,
  state            TEXT,
  district         TEXT,
  pincode          TEXT,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  products_carried UUID[] NOT NULL DEFAULT '{}',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_dealers_district ON dealers (state, district) WHERE is_active = TRUE;

-- ---------- Leads ----------
CREATE TABLE leads (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmer_id     UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  diagnosis_id  UUID REFERENCES diagnoses(id) ON DELETE SET NULL,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  dealer_id     UUID REFERENCES dealers(id) ON DELETE SET NULL,
  stage         TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','interested','sold','lost')),
  source        TEXT NOT NULL DEFAULT 'whatsapp_bot',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_stage ON leads (stage, created_at DESC);

-- ---------- Escalations ----------
CREATE TABLE escalations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  farmer_id       UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  agronomist_id   UUID,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','assigned','resolved')),
  priority        TEXT NOT NULL DEFAULT 'p2' CHECK (priority IN ('p1','p2','p3')),
  sla_minutes     INT NOT NULL DEFAULT 30,
  queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at     TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT
);
CREATE INDEX idx_escalations_queue ON escalations (status, priority, queued_at);

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_farmers_updated   BEFORE UPDATE ON farmers   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated  BEFORE UPDATE ON products  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_recs_updated      BEFORE UPDATE ON product_recommendations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leads_updated     BEFORE UPDATE ON leads     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
