CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  avatar_storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS avatar_storage_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

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

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);

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

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS storage_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS resumes_storage_key_idx
  ON resumes (storage_key) WHERE storage_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_primary_per_user_idx
  ON resumes (user_id) WHERE is_primary;

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

CREATE INDEX IF NOT EXISTS jobs_status_posted_at_idx
  ON jobs (status, posted_at DESC NULLS LAST, created_at DESC);

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
  applied_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS applications_applied_at_idx
  ON applications (applied_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS applications_user_applied_at_idx
  ON applications (user_id, applied_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS applications_job_id_idx
  ON applications (job_id);

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