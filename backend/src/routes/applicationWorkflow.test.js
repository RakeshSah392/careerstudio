import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('application workflow tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const candidateIdentity = { email: `app-flow-cand-${suffix}@example.invalid`, fullName: 'Candidate Carl' }
  const recruiter1Identity = { email: `app-flow-rec1-${suffix}@example.invalid`, fullName: 'Recruiter Rita' }
  const recruiter2Identity = { email: `app-flow-rec2-${suffix}@example.invalid`, fullName: 'Recruiter Rob' }
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

  test('application status workflow & recruiter authorization test suite', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })
    const server = app.listen(0)
    await once(server, 'listening')
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`

    try {
      // 1. Setup accounts: Candidate (job_seeker), Recruiter 1 (recruiter), Recruiter 2 (employer)
      const candidate = await signIn(baseUrl, candidateIdentity, 'job_seeker')
      const recruiter1 = await signIn(baseUrl, recruiter1Identity, 'recruiter')
      const recruiter2 = await signIn(baseUrl, recruiter2Identity, 'employer')

      // Recruiter 1 creates Job 1
      const job1Res = await request(baseUrl, '/api/jobs', {
        method: 'POST',
        cookie: recruiter1.cookie,
        body: {
          title: 'Full Stack Engineer',
          company: 'Acme Systems',
          location: 'Remote',
          remote_type: 'remote',
          employment_type: 'full-time',
          description: 'Full stack development role.',
        },
      })
      assert.equal(job1Res.status, 201)
      const job1 = await job1Res.json()
      createdJobIds.push(job1.id)

      // Recruiter 2 creates Job 2
      const job2Res = await request(baseUrl, '/api/jobs', {
        method: 'POST',
        cookie: recruiter2.cookie,
        body: {
          title: 'DevOps Specialist',
          company: 'Cloud Innovators',
          location: 'San Francisco, CA',
          remote_type: 'hybrid',
          employment_type: 'full-time',
          description: 'DevOps infrastructure role.',
        },
      })
      assert.equal(job2Res.status, 201)
      const job2 = await job2Res.json()
      createdJobIds.push(job2.id)

      // Candidate applies to Job 1
      const app1Res = await request(baseUrl, '/api/applications', {
        method: 'POST',
        cookie: candidate.cookie,
        body: {
          job_id: job1.id,
          company: job1.company,
          role: job1.title,
          status: 'Applied',
        },
      })
      assert.equal(app1Res.status, 201)
      const app1 = await app1Res.json()
      createdAppIds.push(app1.id)
      assert.equal(app1.status, 'Applied')

      // Candidate applies to Job 2
      const app2Res = await request(baseUrl, '/api/applications', {
        method: 'POST',
        cookie: candidate.cookie,
        body: {
          job_id: job2.id,
          company: job2.company,
          role: job2.title,
          status: 'Applied',
        },
      })
      assert.equal(app2Res.status, 201)
      const app2 = await app2Res.json()
      createdAppIds.push(app2.id)
      assert.equal(app2.status, 'Applied')

      // TEST 1: Job Seeker CANNOT change application status via PATCH /api/applications/:id -> 403 Forbidden
      await t.test('job seeker cannot change own application status via /api/applications/:id (returns 403)', async () => {
        const patchRes = await request(baseUrl, `/api/applications/${app1.id}`, {
          method: 'PATCH',
          cookie: candidate.cookie,
          body: { status: 'Offer' },
        })
        assert.equal(patchRes.status, 403)
        const body = await patchRes.json()
        assert.match(body.error, /cannot change application status/i)

        // Verify status remains unchanged in database
        const dbRes = await pool.query('SELECT status FROM applications WHERE id = $1', [app1.id])
        assert.equal(dbRes.rows[0].status, 'Applied')
      })

      // TEST 2: Job Seeker CANNOT change application status via /api/employer/applicants/:id -> 403 Forbidden
      await t.test('job seeker cannot change status via /api/employer/applicants/:id (returns 403)', async () => {
        const patchRes = await request(baseUrl, `/api/employer/applicants/${app1.id}`, {
          method: 'PATCH',
          cookie: candidate.cookie,
          body: { status: 'Interview' },
        })
        assert.equal(patchRes.status, 403)
      })

      // TEST 3: Recruiter 1 CAN change status for their own job application to Interview -> 200 OK
      await t.test('recruiter can change status for their own job application (returns 200 and updates DB)', async () => {
        const patchRes = await request(baseUrl, `/api/employer/applicants/${app1.id}`, {
          method: 'PATCH',
          cookie: recruiter1.cookie,
          body: { status: 'Interview' },
        })
        assert.equal(patchRes.status, 200)
        const updated = await patchRes.json()
        assert.equal(updated.id, app1.id)
        assert.equal(updated.status, 'Interview')

        // Verify status in DB
        const dbRes = await pool.query('SELECT status FROM applications WHERE id = $1', [app1.id])
        assert.equal(dbRes.rows[0].status, 'Interview')
      })

      // TEST 4: Recruiter 1 CANNOT change an application belonging to Recruiter 2's job -> 404 Not Found
      await t.test('recruiter cannot change an application belonging to another recruiter (returns 404)', async () => {
        const patchRes = await request(baseUrl, `/api/employer/applicants/${app2.id}`, {
          method: 'PATCH',
          cookie: recruiter1.cookie,
          body: { status: 'Offer' },
        })
        assert.equal(patchRes.status, 404)

        // Also test direct /api/applications/:id cross-tenant isolation
        const patchDirectRes = await request(baseUrl, `/api/applications/${app2.id}`, {
          method: 'PATCH',
          cookie: recruiter1.cookie,
          body: { status: 'Offer' },
        })
        assert.equal(patchDirectRes.status, 404)

        // Verify App 2 status in DB is untouched
        const dbRes = await pool.query('SELECT status FROM applications WHERE id = $1', [app2.id])
        assert.equal(dbRes.rows[0].status, 'Applied')
      })

      // TEST 5: Candidate can still read the updated status via GET /api/applications and GET /api/applications/:id
      await t.test('candidate can view the updated application status (read-only)', async () => {
        // GET list
        const listRes = await request(baseUrl, '/api/applications', { cookie: candidate.cookie })
        assert.equal(listRes.status, 200)
        const list = await listRes.json()
        const app1InList = list.find((a) => a.id === app1.id)
        assert.ok(app1InList)
        assert.equal(app1InList.status, 'Interview')

        // GET single
        const singleRes = await request(baseUrl, `/api/applications/${app1.id}`, { cookie: candidate.cookie })
        assert.equal(singleRes.status, 200)
        const single = await singleRes.json()
        assert.equal(single.id, app1.id)
        assert.equal(single.status, 'Interview')
      })

      // TEST 6: Candidate receives the status-change notification
      await t.test('candidate receives application_status_changed notification when recruiter updates stage', async () => {
        const notifRes = await pool.query(
          'SELECT * FROM notifications WHERE user_id = $1 AND type = $2 AND related_application_id = $3',
          [candidate.user.id, 'application_status_changed', app1.id],
        )
        assert.equal(notifRes.rowCount, 1)
        assert.equal(notifRes.rows[0].title, 'Application status updated')
        assert.match(notifRes.rows[0].message, /moved to Interview/i)
      })

      // TEST 7: Recruiter 1 moves application to Offer
      await t.test('recruiter can update application to Offer stage and candidate sees update', async () => {
        const patchRes = await request(baseUrl, `/api/applications/${app1.id}`, {
          method: 'PATCH',
          cookie: recruiter1.cookie,
          body: { status: 'Offer' },
        })
        assert.equal(patchRes.status, 200)
        const updated = await patchRes.json()
        assert.equal(updated.status, 'Offer')

        // Candidate reads the offer status
        const singleRes = await request(baseUrl, `/api/applications/${app1.id}`, { cookie: candidate.cookie })
        assert.equal(singleRes.status, 200)
        const single = await singleRes.json()
        assert.equal(single.status, 'Offer')
      })
    } finally {
      if (createdAppIds.length) {
        await pool.query('DELETE FROM applications WHERE id = ANY($1)', [createdAppIds]).catch(() => {})
      }
      if (createdJobIds.length) {
        await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobIds]).catch(() => {})
      }
      if (userIds.length) {
        await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [userIds]).catch(() => {})
        await pool.query('DELETE FROM employer_profiles WHERE user_id = ANY($1)', [userIds]).catch(() => {})
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds]).catch(() => {})
      }
      server.close()
    }
  })
}

