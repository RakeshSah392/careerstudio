import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('employer job posting tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const jobSeekerIdentity = { email: `job-seeker-${suffix}@example.invalid`, fullName: 'Seeker One' }
  const employer1Identity = { email: `employer-one-${suffix}@example.invalid`, fullName: 'Employer Alpha' }
  const employer2Identity = { email: `employer-two-${suffix}@example.invalid`, fullName: 'Employer Beta' }
  const recruiterIdentity = { email: `recruiter-${suffix}@example.invalid`, fullName: 'Recruiter Ray' }
  const userIds = []
  const createdJobIds = []
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

  test('employer job posting and ownership test suite', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    try {
      // 1. Unauthenticated create job -> 401
      await t.test('unauthenticated create job returns 401', async () => {
        const res = await request(baseUrl, '/api/jobs', {
          method: 'POST',
          body: {
            title: 'Software Engineer',
            company: 'Acme',
            location: 'Remote',
            remote_type: 'remote',
            employment_type: 'full-time',
            description: 'Build systems',
          },
        })
        assert.equal(res.status, 401)
      })

      // 2. Sign in accounts
      const seeker = await signIn(baseUrl, jobSeekerIdentity, 'job_seeker')
      const employer1 = await signIn(baseUrl, employer1Identity, 'employer')
      const employer2 = await signIn(baseUrl, employer2Identity, 'employer')
      const recruiter = await signIn(baseUrl, recruiterIdentity, 'recruiter')

      // 3. Job seeker create job -> 403 Forbidden
      await t.test('job seeker create job returns 403', async () => {
        const res = await request(baseUrl, '/api/jobs', {
          method: 'POST',
          cookie: seeker.cookie,
          body: {
            title: 'Senior Developer',
            company: 'Seeker Corp',
            location: 'New York',
            remote_type: 'hybrid',
            employment_type: 'full-time',
            description: 'Looking to hire',
          },
        })
        assert.equal(res.status, 403)
      })

      // 4. Validation: reject missing required fields with 400
      await t.test('rejects invalid or missing required fields with 400', async () => {
        const resMissingTitle = await request(baseUrl, '/api/jobs', {
          method: 'POST',
          cookie: employer1.cookie,
          body: {
            company: 'Alpha Tech',
            location: 'San Francisco, CA',
            remote_type: 'hybrid',
            employment_type: 'full-time',
            description: 'Great role',
          },
        })
        assert.equal(resMissingTitle.status, 400)

        const resInvalidRemote = await request(baseUrl, '/api/jobs', {
          method: 'POST',
          cookie: employer1.cookie,
          body: {
            title: 'Backend Engineer',
            company: 'Alpha Tech',
            location: 'San Francisco, CA',
            remote_type: 'invalid_type',
            employment_type: 'full-time',
            description: 'Great role',
          },
        })
        assert.equal(resInvalidRemote.status, 400)

        const resInvalidSalary = await request(baseUrl, '/api/jobs', {
          method: 'POST',
          cookie: employer1.cookie,
          body: {
            title: 'Backend Engineer',
            company: 'Alpha Tech',
            location: 'San Francisco, CA',
            remote_type: 'onsite',
            employment_type: 'full-time',
            description: 'Great role',
            salary_min: 150000,
            salary_max: 100000, // min > max
          },
        })
        assert.equal(resInvalidSalary.status, 400)
      })

      let employer1JobId = null
      let recruiterJobId = null

      // 5. Employer 1 creates job -> 201 and created_by_user_id always set from session
      await t.test('employer create job succeeds and enforces session ownership', async () => {
        const res = await request(baseUrl, '/api/jobs', {
          method: 'POST',
          cookie: employer1.cookie,
          body: {
            created_by_user_id: seeker.user.id, // Attempt to spoof creator
            title: 'Staff Platform Engineer',
            company: 'Alpha Technologies',
            location: 'Austin, TX',
            remote_type: 'remote',
            employment_type: 'full-time',
            industry: 'Cloud Infrastructure',
            description: 'Lead platform initiatives and Kubernetes tooling.',
            source_url: 'https://alphatech.example.com/careers/staff-platform',
            salary_min: 160000,
            salary_max: 210000,
            currency: 'USD',
          },
        })
        assert.equal(res.status, 201)
        const job = await res.json()
        assert.ok(job.id)
        assert.equal(job.title, 'Staff Platform Engineer')
        assert.equal(job.company, 'Alpha Technologies')
        assert.equal(job.location, 'Austin, TX')
        assert.equal(job.remote_type, 'remote')
        assert.equal(job.employment_type, 'full-time')
        assert.equal(job.industry, 'Cloud Infrastructure')
        assert.equal(Number(job.salary_min), 160000)
        assert.equal(Number(job.salary_max), 210000)
        assert.equal(job.currency, 'USD')
        assert.equal(job.status, 'open')
        // CRITICAL: created_by_user_id must match employer1, NOT the spoofed seeker.user.id
        assert.equal(job.created_by_user_id, employer1.user.id)
        employer1JobId = job.id
        createdJobIds.push(job.id)
      })

      // 6. Recruiter creates job -> 201
      await t.test('recruiter create job succeeds', async () => {
        const res = await request(baseUrl, '/api/jobs', {
          method: 'POST',
          cookie: recruiter.cookie,
          body: {
            title: 'Frontend Architect',
            company: 'Ray Talent Group',
            location: 'Remote',
            remote_type: 'remote',
            employment_type: 'contract',
            industry: 'FinTech',
            description: 'Design design-system architectures and microfrontends.',
            salary_min: 140000,
            salary_max: 180000,
          },
        })
        assert.equal(res.status, 201)
        const job = await res.json()
        assert.equal(job.title, 'Frontend Architect')
        assert.equal(job.created_by_user_id, recruiter.user.id)
        recruiterJobId = job.id
        createdJobIds.push(job.id)
      })

      // 7. Employer can view own jobs via GET /api/employer/jobs
      await t.test('employer can retrieve own jobs list', async () => {
        const res = await request(baseUrl, '/api/employer/jobs', { cookie: employer1.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()
        assert.ok(Array.isArray(data.jobs))
        assert.ok(data.jobs.some((j) => j.id === employer1JobId))
        // Should not see recruiter's job in their own jobs list
        assert.ok(!data.jobs.some((j) => j.id === recruiterJobId))
      })

      // 8. Employer can update own job
      await t.test('employer can update own job fields', async () => {
        const res = await request(baseUrl, `/api/jobs/${employer1JobId}`, {
          method: 'PATCH',
          cookie: employer1.cookie,
          body: {
            title: 'Lead Platform Architect',
            salary_max: 230000,
          },
        })
        assert.equal(res.status, 200)
        const job = await res.json()
        assert.equal(job.title, 'Lead Platform Architect')
        assert.equal(Number(job.salary_max), 230000)
      })

      // 9. Employer 2 CANNOT update Employer 1's job
      await t.test('employer cannot modify another employers job', async () => {
        const res = await request(baseUrl, `/api/jobs/${employer1JobId}`, {
          method: 'PATCH',
          cookie: employer2.cookie,
          body: {
            title: 'Hacked Title',
          },
        })
        assert.equal(res.status, 404)
      })

      // 10. Employer 2 CANNOT close Employer 1's job
      await t.test('employer cannot close another employers job', async () => {
        const res = await request(baseUrl, `/api/jobs/${employer1JobId}/close`, {
          method: 'POST',
          cookie: employer2.cookie,
        })
        assert.equal(res.status, 404)
      })

      // 11. Public discovery can find open employer job
      await t.test('public discovery returns open employer job', async () => {
        const res = await request(baseUrl, '/api/jobs?status=open')
        assert.equal(res.status, 200)
        const jobs = await res.json()
        assert.ok(jobs.some((j) => j.id === employer1JobId && j.status === 'open'))
      })

      // 12. Employer 1 closes their own job
      await t.test('employer can close own job and it disappears from public open discovery', async () => {
        const closeRes = await request(baseUrl, `/api/jobs/${employer1JobId}/close`, {
          method: 'POST',
          cookie: employer1.cookie,
        })
        assert.equal(closeRes.status, 200)
        const closedJob = await closeRes.json()
        assert.equal(closedJob.status, 'closed')

        // Verify public open discovery DOES NOT return the closed job
        const pubRes = await request(baseUrl, '/api/jobs?status=open')
        assert.equal(pubRes.status, 200)
        const openJobs = await pubRes.json()
        assert.ok(!openJobs.some((j) => j.id === employer1JobId))

        // But employer can still see it in /api/employer/jobs
        const empRes = await request(baseUrl, '/api/employer/jobs', { cookie: employer1.cookie })
        assert.equal(empRes.status, 200)
        const empData = await empRes.json()
        const found = empData.jobs.find((j) => j.id === employer1JobId)
        assert.ok(found)
        assert.equal(found.status, 'closed')
      })

      // 13. Employer 1 reopens their closed job
      await t.test('employer can reopen closed job', async () => {
        const reopenRes = await request(baseUrl, `/api/jobs/${employer1JobId}/reopen`, {
          method: 'POST',
          cookie: employer1.cookie,
        })
        assert.equal(reopenRes.status, 200)
        const reopenedJob = await reopenRes.json()
        assert.equal(reopenedJob.status, 'open')

        // Verify public open discovery now returns it again
        const pubRes = await request(baseUrl, '/api/jobs?status=open')
        assert.equal(pubRes.status, 200)
        const openJobs = await pubRes.json()
        assert.ok(openJobs.some((j) => j.id === employer1JobId))
      })
    } finally {
      // Cleanup created jobs and users
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
