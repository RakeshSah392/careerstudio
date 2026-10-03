import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('employer dashboard tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const jobSeekerIdentity = { email: `dash-test-seeker-${suffix}@example.invalid`, fullName: 'Seeker Applicant' }
  const employer1Identity = { email: `dash-test-emp1-${suffix}@example.invalid`, fullName: 'Employer Alpha Corp' }
  const employer2Identity = { email: `dash-test-emp2-${suffix}@example.invalid`, fullName: 'Employer Beta LLC' }
  const recruiterIdentity = { email: `dash-test-recruiter-${suffix}@example.invalid`, fullName: 'Recruiter Ray' }
  const userIds = []
  const createdJobIds = []
  const createdAppIds = []
  const deliveredCodes = new Map()

  async function request(baseUrl, path, { method = 'GET', body, cookie } = {}) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  async function signIn(baseUrl, identity, role = 'job_seeker') {
    const otpRes = await request(baseUrl, '/api/auth/otp/request', {
      method: 'POST',
      body: { email: identity.email },
    })
    assert.equal(otpRes.status, 202)
    const code = deliveredCodes.get(identity.email)
    assert.ok(code)
    const verifyRes = await request(baseUrl, '/api/auth/otp/verify', {
      method: 'POST',
      body: { email: identity.email, code, full_name: identity.fullName },
    })
    assert.equal(verifyRes.status, 200)
    const { user } = await verifyRes.json()
    const setCookie = verifyRes.headers.get('set-cookie')
    assert.ok(setCookie)
    userIds.push(user.id)

    if (role !== 'job_seeker') {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id])
      user.role = role
    }

    return { user, cookie: setCookie.split(';', 1)[0] }
  }

  test('employer dashboard and analytics test suite', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })
    const server = app.listen(0)
    await once(server, 'listening')
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`

    try {
      // 1. Unauthenticated access -> 401
      await t.test('unauthenticated dashboard returns 401', async () => {
        const res = await request(baseUrl, '/api/employer/dashboard')
        assert.equal(res.status, 401)
      })

      // 2. Sign in accounts
      const seeker = await signIn(baseUrl, jobSeekerIdentity, 'job_seeker')
      const employer1 = await signIn(baseUrl, employer1Identity, 'employer')
      const employer2 = await signIn(baseUrl, employer2Identity, 'employer')
      const recruiter = await signIn(baseUrl, recruiterIdentity, 'recruiter')

      // 3. Job seeker role -> 403
      await t.test('job seeker accessing dashboard returns 403', async () => {
        const res = await request(baseUrl, '/api/employer/dashboard', { cookie: seeker.cookie })
        assert.equal(res.status, 403)
      })

      // 4. Employer 1 creates 2 jobs: 1 open, 1 closed
      const job1Res = await request(baseUrl, '/api/jobs', {
        method: 'POST',
        cookie: employer1.cookie,
        body: {
          title: 'Senior Frontend Engineer',
          company: 'Alpha Corp',
          location: 'Remote',
          remote_type: 'remote',
          employment_type: 'full-time',
          description: 'Frontend role',
        },
      })
      assert.equal(job1Res.status, 201)
      const job1 = await job1Res.json()
      createdJobIds.push(job1.id)

      const job2Res = await request(baseUrl, '/api/jobs', {
        method: 'POST',
        cookie: employer1.cookie,
        body: {
          title: 'Staff Backend Architect',
          company: 'Alpha Corp',
          location: 'San Francisco, CA',
          remote_type: 'hybrid',
          employment_type: 'full-time',
          description: 'Backend role',
          status: 'closed',
        },
      })
      assert.equal(job2Res.status, 201)
      const job2 = await job2Res.json()
      createdJobIds.push(job2.id)

      // Employer 2 creates 1 open job
      const job3Res = await request(baseUrl, '/api/jobs', {
        method: 'POST',
        cookie: employer2.cookie,
        body: {
          title: 'DevOps Lead',
          company: 'Beta LLC',
          location: 'Austin, TX',
          remote_type: 'onsite',
          employment_type: 'full-time',
          description: 'DevOps role',
        },
      })
      assert.equal(job3Res.status, 201)
      const job3 = await job3Res.json()
      createdJobIds.push(job3.id)

      // Create applications for Employer 1 Job 1: 1 Applied, 1 Interview, 1 Offer
      const app1Res = await pool.query(
        `INSERT INTO applications (user_id, job_id, company, role, location, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'Applied', NOW() - INTERVAL '2 hours')
         RETURNING id`,
        [seeker.user.id, job1.id, job1.company, job1.title, job1.location],
      )
      createdAppIds.push(app1Res.rows[0].id)

      const app2Res = await pool.query(
        `INSERT INTO applications (user_id, job_id, company, role, location, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'Interview', NOW() - INTERVAL '1 hour')
         RETURNING id`,
        [seeker.user.id, job1.id, job1.company, job1.title, job1.location],
      )
      createdAppIds.push(app2Res.rows[0].id)

      const app3Res = await pool.query(
        `INSERT INTO applications (user_id, job_id, company, role, location, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'Offer', NOW())
         RETURNING id`,
        [seeker.user.id, job1.id, job1.company, job1.title, job1.location],
      )
      createdAppIds.push(app3Res.rows[0].id)

      // Create application for Employer 2 Job 3: 1 Rejected
      const app4Res = await pool.query(
        `INSERT INTO applications (user_id, job_id, company, role, location, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'Rejected', NOW())
         RETURNING id`,
        [seeker.user.id, job3.id, job3.company, job3.title, job3.location],
      )
      createdAppIds.push(app4Res.rows[0].id)

      // 5. Employer 1 retrieves dashboard and verifies counts
      await t.test('employer A dashboard returns accurate summary and per-job metrics', async () => {
        const res = await request(baseUrl, '/api/employer/dashboard', { cookie: employer1.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()
        assert.ok(data.ok)

        // Job summary metrics
        assert.equal(data.summary.jobs.total_jobs, 2)
        assert.equal(data.summary.jobs.open_jobs, 1)
        assert.equal(data.summary.jobs.closed_jobs, 1)

        // Application summary metrics
        assert.equal(data.summary.applications.total_applications, 3)
        assert.equal(data.summary.applications.applied_applications, 1)
        assert.equal(data.summary.applications.interview_applications, 1)
        assert.equal(data.summary.applications.offer_applications, 1)
        assert.equal(data.summary.applications.rejected_applications, 0)
        assert.equal(data.summary.applications.saved_applications, 0)

        // Per-job analytics
        assert.equal(data.jobs_analytics.length, 2)
        const job1Stats = data.jobs_analytics.find((j) => j.id === job1.id)
        assert.ok(job1Stats)
        assert.equal(job1Stats.applicant_count, 3)
        assert.equal(job1Stats.interview_count, 1)
        assert.equal(job1Stats.offer_count, 1)
        assert.equal(job1Stats.rejected_count, 0)

        const job2Stats = data.jobs_analytics.find((j) => j.id === job2.id)
        assert.ok(job2Stats)
        assert.equal(job2Stats.applicant_count, 0)

        // Recent activity
        assert.ok(Array.isArray(data.recent_activity.recent_jobs))
        assert.equal(data.recent_activity.recent_jobs.length, 2)
        assert.ok(Array.isArray(data.recent_activity.recent_applications))
        assert.equal(data.recent_activity.recent_applications.length, 3)
        assert.equal(data.recent_activity.recent_applications[0].applicant_email, seeker.user.email)
      })

      // 6. Cross-tenant isolation: Employer 2 dashboard contains only Employer 2 metrics
      await t.test('employer B dashboard contains only employer B metrics without leakage', async () => {
        const res = await request(baseUrl, '/api/employer/dashboard', { cookie: employer2.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()

        assert.equal(data.summary.jobs.total_jobs, 1)
        assert.equal(data.summary.jobs.open_jobs, 1)
        assert.equal(data.summary.jobs.closed_jobs, 0)

        assert.equal(data.summary.applications.total_applications, 1)
        assert.equal(data.summary.applications.rejected_applications, 1)
        assert.equal(data.summary.applications.offer_applications, 0)

        assert.equal(data.jobs_analytics.length, 1)
        assert.equal(data.jobs_analytics[0].id, job3.id)
        assert.equal(data.jobs_analytics[0].applicant_count, 1)
        assert.equal(data.jobs_analytics[0].rejected_count, 1)

        assert.equal(data.recent_activity.recent_jobs.length, 1)
        assert.equal(data.recent_activity.recent_applications.length, 1)
        assert.equal(data.recent_activity.recent_applications[0].job_id, job3.id)
      })

      // 7. Recruiter role dashboard access
      await t.test('recruiter role receives empty initialized metrics when no jobs posted', async () => {
        const res = await request(baseUrl, '/api/employer/dashboard', { cookie: recruiter.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()
        assert.equal(data.summary.jobs.total_jobs, 0)
        assert.equal(data.summary.applications.total_applications, 0)
        assert.equal(data.jobs_analytics.length, 0)
        assert.equal(data.recent_activity.recent_jobs.length, 0)
        assert.equal(data.recent_activity.recent_applications.length, 0)
      })
    } finally {
      if (createdAppIds.length) {
        await pool.query('DELETE FROM applications WHERE id = ANY($1)', [createdAppIds]).catch(() => {})
      }
      if (createdJobIds.length) {
        await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobIds]).catch(() => {})
      }
      if (userIds.length) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds]).catch(() => {})
      }
      server.close()
    }
  })
}

