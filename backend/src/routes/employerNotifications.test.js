import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('employer notifications tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const jobSeekerIdentity = { email: `notif-seeker-${suffix}@example.invalid`, fullName: 'Seeker Sam' }
  const employer1Identity = { email: `notif-emp1-${suffix}@example.invalid`, fullName: 'Employer One' }
  const employer2Identity = { email: `notif-emp2-${suffix}@example.invalid`, fullName: 'Employer Two' }
  const recruiterIdentity = { email: `notif-rec-${suffix}@example.invalid`, fullName: 'Recruiter Rita' }
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

  test('employer notifications test suite', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })
    const server = app.listen(0)
    await once(server, 'listening')
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`

    t.after(async () => {
      server.close()
      if (createdAppIds.length) {
        await pool.query('DELETE FROM applications WHERE id = ANY($1)', [createdAppIds])
      }
      if (createdJobIds.length) {
        await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobIds])
      }
      if (userIds.length) {
        await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM employer_profiles WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds])
      }
    })

    const seeker = await signIn(baseUrl, jobSeekerIdentity, 'job_seeker')
    const emp1 = await signIn(baseUrl, employer1Identity, 'employer')
    const emp2 = await signIn(baseUrl, employer2Identity, 'employer')
    const rec = await signIn(baseUrl, recruiterIdentity, 'recruiter')

    // Create jobs for emp1 and emp2
    const job1Res = await request(baseUrl, '/api/jobs', {
      method: 'POST',
      cookie: emp1.cookie,
      body: {
        title: 'Senior Frontend Architect',
        company: 'Alpha Digital',
        location: 'Remote',
        remote_type: 'remote',
        employment_type: 'full-time',
        description: 'Lead frontend architecture using React.',
      },
    })
    assert.equal(job1Res.status, 201)
    const job1 = await job1Res.json()
    createdJobIds.push(job1.id)

    const job2Res = await request(baseUrl, '/api/jobs', {
      method: 'POST',
      cookie: emp2.cookie,
      body: {
        title: 'Backend Systems Engineer',
        company: 'Beta Systems',
        location: 'Austin, TX',
        remote_type: 'hybrid',
        employment_type: 'full-time',
        description: 'Scale Node.js and PostgreSQL services.',
      },
    })
    assert.equal(job2Res.status, 201)
    const job2 = await job2Res.json()
    createdJobIds.push(job2.id)

    await t.test('unauthenticated access to notifications returns 401', async () => {
      const res = await request(baseUrl, '/api/employer/notifications')
      assert.equal(res.status, 401)
    })

    await t.test('job seeker GET notifications returns 403 Forbidden', async () => {
      const res = await request(baseUrl, '/api/employer/notifications', { cookie: seeker.cookie })
      assert.equal(res.status, 403)
    })

    await t.test('new application creates employer notification automatically', async () => {
      const applyRes = await request(baseUrl, '/api/applications', {
        method: 'POST',
        cookie: seeker.cookie,
        body: {
          job_id: job1.id,
          status: 'Applied',
        },
      })
      assert.equal(applyRes.status, 201)
      const appRecord = await applyRes.json()
      createdAppIds.push(appRecord.id)

      // Check emp1 notifications
      const notifRes = await request(baseUrl, '/api/employer/notifications', { cookie: emp1.cookie })
      assert.equal(notifRes.status, 200)
      const data = await notifRes.json()
      assert.equal(data.ok, true)
      assert.equal(data.unread_count, 1)
      assert.equal(data.notifications.length, 1)
      assert.equal(data.notifications[0].type, 'new_application')
      assert.equal(data.notifications[0].related_job_id, job1.id)
      assert.equal(data.notifications[0].related_application_id, appRecord.id)
      assert.equal(data.notifications[0].is_read, false)
      assert.match(data.notifications[0].message, /Seeker Sam submitted an application for "Senior Frontend Architect"/)
    })

    await t.test('employer isolation: employer 2 cannot see employer 1 notifications', async () => {
      const notifRes = await request(baseUrl, '/api/employer/notifications', { cookie: emp2.cookie })
      assert.equal(notifRes.status, 200)
      const data = await notifRes.json()
      assert.equal(data.ok, true)
      assert.equal(data.unread_count, 0)
      assert.equal(data.notifications.length, 0)
    })

    await t.test('recruiter can retrieve own notifications (empty state)', async () => {
      const notifRes = await request(baseUrl, '/api/employer/notifications', { cookie: rec.cookie })
      assert.equal(notifRes.status, 200)
      const data = await notifRes.json()
      assert.equal(data.ok, true)
      assert.equal(data.unread_count, 0)
      assert.deepEqual(data.notifications, [])
    })

    await t.test('employer 2 cannot mark employer 1 notification as read', async () => {
      const emp1Notifs = await (await request(baseUrl, '/api/employer/notifications', { cookie: emp1.cookie })).json()
      const notifId = emp1Notifs.notifications[0].id

      const patchRes = await request(baseUrl, `/api/employer/notifications/${notifId}/read`, {
        method: 'PATCH',
        cookie: emp2.cookie,
      })
      assert.equal(patchRes.status, 404)
    })

    await t.test('employer 1 can mark own notification as read', async () => {
      const emp1Notifs = await (await request(baseUrl, '/api/employer/notifications', { cookie: emp1.cookie })).json()
      const notifId = emp1Notifs.notifications[0].id

      const patchRes = await request(baseUrl, `/api/employer/notifications/${notifId}/read`, {
        method: 'PATCH',
        cookie: emp1.cookie,
      })
      assert.equal(patchRes.status, 200)
      const data = await patchRes.json()
      assert.equal(data.ok, true)
      assert.equal(data.notification.is_read, true)

      // Verify unread count decreases
      const afterRes = await request(baseUrl, '/api/employer/notifications', { cookie: emp1.cookie })
      const afterData = await afterRes.json()
      assert.equal(afterData.unread_count, 0)
      assert.equal(afterData.notifications[0].is_read, true)
    })

    await t.test('unread filter works correctly', async () => {
      // Create a second application on job1
      const apply2Res = await request(baseUrl, '/api/applications', {
        method: 'POST',
        cookie: seeker.cookie,
        body: {
          job_id: job1.id,
          company: 'Alpha Digital',
          role: 'Senior Frontend Architect',
          status: 'Applied',
        },
      })
      assert.equal(apply2Res.status, 201)
      const app2Record = await apply2Res.json()
      createdAppIds.push(app2Record.id)

      // Total notifications should be 2, unread should be 1
      const allRes = await request(baseUrl, '/api/employer/notifications', { cookie: emp1.cookie })
      const allData = await allRes.json()
      assert.equal(allData.unread_count, 1)
      assert.equal(allData.notifications.length, 2)

      // Filter unread
      const unreadRes = await request(baseUrl, '/api/employer/notifications?filter=unread', { cookie: emp1.cookie })
      const unreadData = await unreadRes.json()
      assert.equal(unreadData.unread_count, 1)
      assert.equal(unreadData.notifications.length, 1)
      assert.equal(unreadData.notifications[0].is_read, false)
    })

    await t.test('POST /read-all marks all unread notifications as read for current employer only', async () => {
      const readAllRes = await request(baseUrl, '/api/employer/notifications/read-all', {
        method: 'POST',
        cookie: emp1.cookie,
      })
      assert.equal(readAllRes.status, 200)
      const result = await readAllRes.json()
      assert.equal(result.ok, true)
      assert.equal(result.updated_count, 1)

      // Check unread count is now 0
      const afterRes = await request(baseUrl, '/api/employer/notifications', { cookie: emp1.cookie })
      const afterData = await afterRes.json()
      assert.equal(afterData.unread_count, 0)
      assert.ok(afterData.notifications.every((n) => n.is_read === true))
    })

    await t.test('updating applicant status creates notification for candidate', async () => {
      const patchAppRes = await request(baseUrl, `/api/employer/applicants/${createdAppIds[0]}`, {
        method: 'PATCH',
        cookie: emp1.cookie,
        body: { status: 'Interview' },
      })
      assert.equal(patchAppRes.status, 200)

      // Verify candidate has a notification in DB
      const notifRows = await pool.query(
        'SELECT * FROM notifications WHERE user_id = $1 AND type = $2 AND related_application_id = $3',
        [seeker.user.id, 'application_status_changed', createdAppIds[0]],
      )
      assert.equal(notifRows.rowCount, 1)
      assert.equal(notifRows.rows[0].title, 'Application status updated')
      assert.match(notifRows.rows[0].message, /moved to Interview/)
    })
  })
}
