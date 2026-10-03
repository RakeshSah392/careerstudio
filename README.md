# Career Studio

A full-stack foundation for a job application agent, built with React, Vite, Express, and PostgreSQL. It includes a working application pipeline and APIs/data models for users, resumes, preferences, jobs, matches, and applications.

## Setup

- Node.js 20.19+ or 22.12+
- npm
- A local PostgreSQL 18 server

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` in `.env` to your PostgreSQL 18 connection string. URL-encode special characters in the username or password.
3. For persistent local sessions, set `SESSION_SECRET` and `OTP_PEPPER` to different random values of at least 32 characters.
4. Install dependencies with `npm install`.
5. Verify the database connection with `npm run db:check`.
6. Start the API and frontend with `npm run dev`.

The backend loads `.env` from the repository root regardless of its working directory. Process-level variables take precedence. `.env` is git-ignored and should not be committed. If local auth secrets are omitted, development uses ephemeral secrets and sessions/OTP codes stop working after a backend restart. Production requires explicit strong secrets.

Open the Vite URL printed in the terminal, normally `http://localhost:5173`. The API listens on port 4000. Vite proxies `/api` requests to Express. `GET /api/health` checks the database connection and PostgreSQL major version; it returns only status/version information and never connection details.

Apply `backend/db/schema.sql` to your PostgreSQL 18 database before using resource endpoints. For example, use `psql "$env:DATABASE_URL" -f backend/db/schema.sql` from PowerShell after setting the URL in your session, or run the equivalent command with your database client.

## API Resources

- Public: `GET /api/health`, `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`
- Authenticated: `POST /api/auth/logout`, `GET /api/auth/me`, user/profile, resume, preference, match, and application routes
- `POST /api/users` now requires authentication and only updates/returns the current profile; OTP verification creates accounts.
- `GET /api/users/me`, `PATCH /api/users/me`, `POST /api/users/me/avatar`, `GET /api/users/me/avatar`, `DELETE /api/users/me/avatar`
- `GET /api/resumes/me`, `GET /api/resumes?user_id=:id`, `POST /api/resumes`, `POST /api/resumes/upload`, `GET /api/resumes/:id`, `GET /api/resumes/:id/file`, `PUT /api/resumes/:id/file`, `PATCH /api/resumes/:id`, `DELETE /api/resumes/:id`
- `GET /api/preferences/:userId`, `POST /api/preferences`, `PUT /api/preferences/:userId`
- `GET /api/jobs`, `POST /api/jobs`, `GET /api/jobs/:id`, `PATCH /api/jobs/:id`, `DELETE /api/jobs/:id`
- `GET /api/matches?user_id=:id`, `POST /api/matches/refresh`, `PATCH /api/matches/:id`
- `GET /api/applications`, `POST /api/applications`, `GET /api/applications/:id`, `PATCH /api/applications/:id`, `DELETE /api/applications/:id`

Authenticated routes scope user-owned records to the session user; supplied `user_id` values are checked against that identity. The session cookie is HTTP-only, same-site, and secure in production. OTPs are HMAC-hashed, expire after ten minutes, allow five attempts, and are single-use. In development, `OTP_DELIVERY_MODE=console` prints the OTP in the API terminal; no external provider is integrated. OTP requests are rate-limited. A shared rate-limit store should be configured before multi-instance deployment.

Public job reads return open jobs only. Job writes require authentication and are limited to the creator. The match refresh uses deterministic preference scoring, not AI. Jobs are entered manually; there are no job-board integrations. Resume JSON/text records remain supported; PDF and DOCX uploads are stored locally under `backend/.data/resumes` by default (override with `RESUME_STORAGE_DIR`). PostgreSQL stores only resume metadata and a generated storage key; downloads are authenticated and sent as attachments.

Profile images accept JPEG, PNG, or WebP uploads up to 5 MB and are decoded, pixel-limited, and normalized to WebP. Development stores files under `backend/.data/profile-images`; set `PROFILE_IMAGE_DIR` to use another local directory. PostgreSQL stores only each generated user-scoped storage key. The storage adapter is isolated in `backend/src/services/profileImageStorage.js` for later replacement with cloud storage.

The frontend has no login UI yet. Until it is added, authenticated dashboard requests must use an API client that retains the session cookie. A production OTP delivery adapter and email-change verification flow are also still required.

## Scripts

- `npm run dev` starts frontend and API together.
- `npm run build` creates the production frontend bundle.
- `npm test` runs backend matcher tests.
- `npm run test:integration` runs the PostgreSQL-backed auth/ownership flow with an injected OTP sender and cleans up its temporary data.
- `npm run test:profile` tests profile and image operations against PostgreSQL and removes its temporary users/files.
- `npm run test:resume` tests PDF/DOCX upload, current-resume lookup, replacement, download, deletion, ownership, and cleanup against PostgreSQL.
- `npm run db:check` verifies the configured PostgreSQL connection and requires version 18.
- `npm start` starts the API without watch mode.

## Structure

- `frontend/` React UI and Vite configuration
- `backend/src/routes/` REST resources
- `backend/src/services/` matching logic
- `backend/db/schema.sql` PostgreSQL schema and additive application migration
- `docker-compose.yml` optional PostgreSQL service

Both workspaces use JavaScript ES modules.