-- =============================================================================
-- CareerStudio — Complete Database Schema
-- Compatible with PostgreSQL 14, 15, 16, 17, and 18
-- Safe for fresh databases and existing partially populated databases.
-- =============================================================================

-- Ensure UUID generation functions are available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. USERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'job_seeker',
  email_verified_at TIMESTAMPTZ,
  avatar_storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column updates for existing databases
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'job_seeker',
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS avatar_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

-- -----------------------------------------------------------------------------
-- 2. OTP CHALLENGES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS otp_challenges_email_created_idx
  ON otp_challenges (email, created_at DESC);

CREATE INDEX IF NOT EXISTS otp_challenges_expiry_idx
  ON otp_challenges (expires_at) WHERE consumed_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. USER SESSIONS TABLE (connect-pg-simple)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);

-- -----------------------------------------------------------------------------
-- 4. RESUMES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_filename TEXT,
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  content_text TEXT NOT NULL DEFAULT '',
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  storage_key TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column updates
ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS resumes_user_id_idx ON resumes (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS resumes_storage_key_idx
  ON resumes (storage_key) WHERE storage_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_primary_per_user_idx
  ON resumes (user_id) WHERE is_primary;

-- -----------------------------------------------------------------------------
-- 5. JOB PREFERENCES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  locations TEXT[] NOT NULL DEFAULT '{}',
  remote_preference TEXT NOT NULL DEFAULT 'any'
    CHECK (remote_preference IN ('any', 'remote', 'hybrid', 'onsite')),
  employment_types TEXT[] NOT NULL DEFAULT '{}',
  industries TEXT[] NOT NULL DEFAULT '{}',
  min_salary NUMERIC(12, 2) CHECK (min_salary IS NULL OR min_salary >= 0),
  max_salary NUMERIC(12, 2) CHECK (max_salary IS NULL OR max_salary >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_salary IS NULL OR max_salary IS NULL OR min_salary <= max_salary)
);

CREATE INDEX IF NOT EXISTS job_preferences_user_id_idx ON job_preferences (user_id);

-- -----------------------------------------------------------------------------
-- 6. JOBS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  remote_type TEXT NOT NULL DEFAULT 'onsite'
    CHECK (remote_type IN ('remote', 'hybrid', 'onsite')),
  employment_type TEXT NOT NULL DEFAULT 'full-time',
  industry TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  salary_min NUMERIC(12, 2) CHECK (salary_min IS NULL OR salary_min >= 0),
  salary_max NUMERIC(12, 2) CHECK (salary_max IS NULL OR salary_max >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  posted_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max)
);

-- Idempotent column updates
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS jobs_status_posted_at_idx
  ON jobs (status, posted_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_created_by_user_id_idx
  ON jobs (created_by_user_id);

-- -----------------------------------------------------------------------------
-- 7. APPLICATIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Saved'
    CHECK (status IN ('Saved', 'Applied', 'Interview', 'Offer', 'Rejected')),
  source TEXT NOT NULL DEFAULT 'manual',
  applied_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column updates
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS applications_applied_at_idx
  ON applications (applied_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS applications_user_applied_at_idx
  ON applications (user_id, applied_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS applications_job_id_idx
  ON applications (job_id);

-- -----------------------------------------------------------------------------
-- 8. JOB MATCHES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_breakdown JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'saved', 'dismissed', 'applied')),
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS job_matches_user_score_idx
  ON job_matches (user_id, score DESC, matched_at DESC);

CREATE INDEX IF NOT EXISTS job_matches_user_job_idx
  ON job_matches (user_id, job_id);

-- -----------------------------------------------------------------------------
-- 9. APPLICATION PROFILES TABLE (Auto-Apply Candidate Profile)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT NOT NULL DEFAULT '',
  current_job_title TEXT NOT NULL DEFAULT '',
  professional_introduction TEXT NOT NULL DEFAULT '',
  skills TEXT[] NOT NULL DEFAULT '{}',
  experience_level TEXT NOT NULL DEFAULT 'mid',
  years_of_experience NUMERIC(4, 1) NOT NULL DEFAULT 0,
  joining_status TEXT NOT NULL DEFAULT 'immediate',
  notice_period_days INT NOT NULL DEFAULT 0,
  available_from DATE,
  willing_to_relocate BOOLEAN NOT NULL DEFAULT FALSE,
  expected_salary NUMERIC(12, 2),
  minimum_acceptable_salary NUMERIC(12, 2),
  salary_currency CHAR(3) NOT NULL DEFAULT 'USD',
  salary_period TEXT NOT NULL DEFAULT 'yearly',
  preferred_roles TEXT[] NOT NULL DEFAULT '{}',
  preferred_locations TEXT[] NOT NULL DEFAULT '{}',
  remote_preference TEXT NOT NULL DEFAULT 'any',
  employment_types TEXT[] NOT NULL DEFAULT '{}',
  preferred_industries TEXT[] NOT NULL DEFAULT '{}',
  work_authorization TEXT NOT NULL DEFAULT '',
  shift_availability TEXT NOT NULL DEFAULT 'day',
  relocation_preference TEXT NOT NULL DEFAULT 'open',
  custom_answers JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS application_profiles_user_id_idx
  ON application_profiles (user_id);

-- -----------------------------------------------------------------------------
-- 10. AUTO-APPLY SETTINGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auto_apply_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_match_percentage INT NOT NULL DEFAULT 80,
  allowed_job_sources TEXT[] NOT NULL DEFAULT '{direct,recruiter}',
  allowed_employment_types TEXT[] NOT NULL DEFAULT '{full-time,contract,part-time}',
  allowed_work_modes TEXT[] NOT NULL DEFAULT '{remote,hybrid,onsite}',
  require_resume BOOLEAN NOT NULL DEFAULT TRUE,
  require_complete_profile BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auto_apply_settings_user_id_idx
  ON auto_apply_settings (user_id);

-- -----------------------------------------------------------------------------
-- 11. AUTO-APPLY QUEUE TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auto_apply_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_source TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('eligible', 'queued', 'processing', 'applied', 'failed', 'blocked')),
  match_score SMALLINT,
  failure_reason TEXT,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_auto_apply_queue_user_job UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS auto_apply_queue_user_status_created_idx
  ON auto_apply_queue (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS auto_apply_queue_user_job_idx
  ON auto_apply_queue (user_id, job_id);

-- -----------------------------------------------------------------------------
-- 12. EMPLOYER PROFILES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  company_website TEXT NOT NULL DEFAULT '',
  company_description TEXT NOT NULL DEFAULT '',
  recruiter_name TEXT NOT NULL,
  recruiter_email TEXT NOT NULL,
  recruiter_phone TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employer_profiles_user_id_idx
  ON employer_profiles (user_id);

-- -----------------------------------------------------------------------------
-- 13. NOTIFICATIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  related_application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
  ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_type_app_idx
  ON notifications (user_id, type, related_application_id);

-- -----------------------------------------------------------------------------
-- 14. EXTERNAL JOBS TABLE (Aggregated / Ingested Jobs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  description TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full-time',
  remote_type TEXT,
  industry TEXT,
  salary_min NUMERIC(12, 2),
  salary_max NUMERIC(12, 2),
  currency CHAR(3),
  posted_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_provider_update_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  fingerprint TEXT,
  raw_metadata JSONB NOT NULL DEFAULT '{}',
  attribution JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_external_jobs_source_id UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS external_jobs_fingerprint_idx ON external_jobs (fingerprint);
CREATE INDEX IF NOT EXISTS external_jobs_last_seen_at_idx ON external_jobs (last_seen_at);
CREATE INDEX IF NOT EXISTS external_jobs_posted_at_idx ON external_jobs (posted_at DESC NULLS LAST);

-- -----------------------------------------------------------------------------
-- 15. EXTERNAL JOB SEARCHES CACHE TABLE (Search Query & Pagination Cache)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_job_searches_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  query_params JSONB NOT NULL DEFAULT '{}',
  result_job_ids TEXT[] NOT NULL DEFAULT '{}',
  total_available INT NOT NULL DEFAULT 0,
  attribution JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_job_searches_cache_expires
  ON external_job_searches_cache (expires_at);

-- -----------------------------------------------------------------------------
-- 16. EXTERNAL APPLICATION CLICKS TABLE (Outbound Click / Analytics Tracking)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_application_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  external_job_id UUID REFERENCES external_jobs(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'external',
  source_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_application_clicks_user
  ON external_application_clicks (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_application_clicks_job
  ON external_application_clicks (external_job_id);

-- -----------------------------------------------------------------------------
-- 17. AI EMBEDDINGS TABLE (Vector Embeddings for RAG / Search)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  source_type VARCHAR(50) NOT NULL,
  source_id UUID NOT NULL,
  chunk_id VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  embedding REAL[] NOT NULL,
  embedding_model VARCHAR(100) NOT NULL,
  dimension INT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ai_embeddings_chunk UNIQUE (source_type, source_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_embeddings_source ON ai_embeddings (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_embeddings_user ON ai_embeddings (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_embeddings_hash ON ai_embeddings (content_hash);

-- -----------------------------------------------------------------------------
-- 18. KITTY CONVERSATIONS TABLE (AI Assistant Sessions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kitty_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kitty_conv_user
  ON kitty_conversations (user_id, updated_at DESC);

-- -----------------------------------------------------------------------------
-- 19. KITTY MESSAGES TABLE (AI Assistant Chat History)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kitty_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES kitty_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kitty_msg_conv
  ON kitty_messages (conversation_id, created_at ASC);
