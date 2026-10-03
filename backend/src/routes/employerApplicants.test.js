import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('employer applicants tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const jobSeekerIdentity = { email: `app-test-seeker-${suffix}@example.invalid`, fullName: 'Seeker Applicant' }
  const employer1Identity = { email: `app-test-emp1-${suffix}@example.invalid`, fullName: 'Employer Alpha Corp' }
  const employer2Identity = { email: `app-test-emp2-${suffix}@example.invalid`, fullName: 'Employer Beta LLC' }
  const recruiterIdentity = { email: `app-test-recruiter-${suffix}@example.invalid`, fullName: 'Recruiter Ray' }
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

  test('employer applicant management test suite', async (t) => {
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
      await t.test('unauthenticated access to applicants returns 401', async () => {
        const getRes = await request(baseUrl, '/api/employer/applicants')
        assert.equal(getRes.status, 401)

        const fakeId = '00000000-0000-4000-8000-000000000001'
        const patchRes = await request(baseUrl, `/api/employer/applicants/${fakeId}`, {
          method: 'PATCH',
          body: { status: 'Interview' },
        })
        assert.equal(patchRes.status, 401)
      })

      // 2. Sign in accounts
      const seeker = await signIn(baseUrl, jobSeekerIdentity, 'job_seeker')
      const employer1 = await signIn(baseUrl, employer1Identity, 'employer')
      const employer2 = await signIn(baseUrl, employer2Identity, 'employer')
      const recruiter = await signIn(baseUrl, recruiterIdentity, 'recruiter')

      // 3. Job seeker role cannot access /api/employer/applicants -> 403
      await t.test('job seeker GET applicants returns 403 Forbidden', async () => {
        const res = await request(baseUrl, '/api/employer/applicants', { cookie: seeker.cookie })
        assert.equal(res.status, 403)
      })

      // Create a job for Employer 1
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

      // Create a job for Employer 2
      const job2Res = await request(baseUrl, '/api/jobs', {
        method: 'POST',
        cookie: employer2.cookie,
        body: {
          title: 'Backend Systems Architect',
          company: 'Beta LLC',
          location: 'New York, NY',
          remote_type: 'hybrid',
          employment_type: 'full-time',
          description: 'Backend role',
        },
      })
      assert.equal(job2Res.status, 201)
      const job2 = await job2Res.json()
      createdJobIds.push(job2.id)

      // Seeker applies to Employer 1 job
      const app1Res = await pool.query(
        `INSERT INTO applications (user_id, job_id, company, role, location, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'Applied', NOW())
         RETURNING id`,
        [seeker.user.id, job1.id, job1.company, job1.title, job1.location],
      )
      const app1Id = app1Res.rows[0].id
      createdAppIds.push(app1Id)

      // Seeker applies to Employer 2 job
      const app2Res = await pool.query(
        `INSERT INTO applications (user_id, job_id, company, role, location, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'Applied', NOW())
         RETURNING id`,
        [seeker.user.id, job2.id, job2.company, job2.title, job2.location],
      )
      const app2Id = app2Res.rows[0].id
      createdAppIds.push(app2Id)

      // 4. Employer 1 retrieves applicants for own job
      await t.test('employer A retrieves applicants for own job', async () => {
        const res = await request(baseUrl, '/api/employer/applicants', { cookie: employer1.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()
        assert.ok(Array.isArray(data.applicants))
        assert.equal(data.applicants.length, 1)
        const app = data.applicants[0]
        assert.equal(app.id, app1Id)
        assert.equal(app.job_id, job1.id)
        assert.equal(app.applicant_email, seeker.user.email)
        assert.equal(app.applicant_name, seeker.user.full_name)
        assert.equal(app.status, 'Applied')
      })

      // 5. Employer 2 retrieves applicants for own job
      await t.test('employer B retrieves applicants for own job', async () => {
        const res = await request(baseUrl, '/api/employer/applicants', { cookie: employer2.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()
        assert.ok(Array.isArray(data.applicants))
        assert.equal(data.applicants.length, 1)
        const app = data.applicants[0]
        assert.equal(app.id, app2Id)
        assert.equal(app.job_id, job2.id)
      })

      // 6. Cross-tenant isolation: Employer 1 cannot see Employer 2's applicants
      await t.test('employer A cannot see applicants for employer B jobs', async () => {
        const res = await request(baseUrl, '/api/employer/applicants', { cookie: employer1.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()
        assert.ok(!data.applicants.some((a) => a.id === app2Id))
      })

      // 7. Recruiter can retrieve applicants for own jobs
      await t.test('recruiter can retrieve applicants for own jobs', async () => {
        const res = await request(baseUrl, '/api/employer/applicants', { cookie: recruiter.cookie })
        assert.equal(res.status, 200)
        const data = await res.json()
        assert.ok(Array.isArray(data.applicants))
        assert.equal(data.applicants.length, 0)
      })

      // 8. Employer 1 updates applicant 1 status to Interview -> 200
      await t.test('employer A can update applicant status to Interview', async () => {
        const patchRes = await request(baseUrl, `/api/employer/applicants/${app1Id}`, {
          method: 'PATCH',
          cookie: employer1.cookie,
          body: { status: 'Interview' },
        })
        assert.equal(patchRes.status, 200)
        const updated = await patchRes.json()
        assert.equal(updated.id, app1Id)
        assert.equal(updated.status, 'Interview')

        // Verify status is updated in DB
        const dbRes = await pool.query('SELECT status FROM applications WHERE id = $1', [app1Id])
        assert.equal(dbRes.rows[0].status, 'Interview')
      })

      // 9. Employer 1 cannot update Employer 2's applicant -> 404
      await t.test('employer A cannot update status for employer B job applicant', async () => {
        const patchRes = await request(baseUrl, `/api/employer/applicants/${app2Id}`, {
          method: 'PATCH',
          cookie: employer1.cookie,
          body: { status: 'Offer' },
        })
        assert.equal(patchRes.status, 404)
      })

      // 10. Invalid status returns 400
      await t.test('invalid status returns 400', async () => {
        const patchRes = await request(baseUrl, `/api/employer/applicants/${app1Id}`, {
          method: 'PATCH',
          cookie: employer1.cookie,
          body: { status: 'InvalidStage' },
        })
        assert.equal(patchRes.status, 400)
      })

      // 11. Nonexistent application ID returns 404
      await t.test('nonexistent application returns 404', async () => {
        const fakeId = '00000000-0000-4000-8000-000000000099'
        const patchRes = await request(baseUrl, `/api/employer/applicants/${fakeId}`, {
          method: 'PATCH',
          cookie: employer1.cookie,
          body: { status: 'Interview' },
        })
        assert.equal(patchRes.status, 404)
      })

      // 12. Filtering by job_id and status
      await t.test('applicants endpoint supports job_id and status filters', async () => {
        const filterJobRes = await request(baseUrl, `/api/employer/applicants?job_id=${job1.id}`, {
          cookie: employer1.cookie,
        })
        assert.equal(filterJobRes.status, 200)
        const filterJobData = await filterJobRes.json()
        assert.equal(filterJobData.applicants.length, 1)

        const filterStatusRes = await request(baseUrl, `/api/employer/applicants?status=Interview`, {
          cookie: employer1.cookie,
        })
        assert.equal(filterStatusRes.status, 200)
        const filterStatusData = await filterStatusRes.json()
        assert.equal(filterStatusData.applicants.length, 1)

        const filterNoneRes = await request(baseUrl, `/api/employer/applicants?status=Rejected`, {
          cookie: employer1.cookie,
        })
        assert.equal(filterNoneRes.status, 200)
        const filterNoneData = await filterNoneRes.json()
        assert.equal(filterNoneData.applicants.length, 0)
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
