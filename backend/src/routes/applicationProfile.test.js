import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('application profile tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const user1Identity = { email: `app-prof-user1-${suffix}@example.invalid`, fullName: 'Profile User One' }
  const user2Identity = { email: `app-prof-user2-${suffix}@example.invalid`, fullName: 'Profile User Two' }
  const userIds = []
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

  async function signIn(baseUrl, identity) {
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
    return { user, cookie: setCookie.split(';', 1)[0] }
  }

  test('application profile test suite', async (t) => {
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
      if (userIds.length) {
        await pool.query('DELETE FROM application_profiles WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM auto_apply_settings WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM resumes WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds])
      }
    })

    const user1 = await signIn(baseUrl, user1Identity)
    const user2 = await signIn(baseUrl, user2Identity)

    await t.test('unauthenticated access returns 401', async () => {
      const res = await request(baseUrl, '/api/application-profile')
      assert.equal(res.status, 401)
    })

    await t.test('returns null profile and zero completeness for fresh account', async () => {
      const res = await request(baseUrl, '/api/application-profile', { cookie: user1.cookie })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ok, true)
      assert.equal(data.profile, null)
      assert.equal(data.completeness.completenessScore, 0)
      assert.equal(data.completeness.isComplete, false)
    })

    await t.test('rejects invalid inputs on save', async () => {
      // Negative salary
      const res1 = await request(baseUrl, '/api/application-profile', {
        method: 'POST',
        cookie: user1.cookie,
        body: { expected_salary: -500 },
      })
      assert.equal(res1.status, 400)

      // Min salary exceeds expected salary
      const res2 = await request(baseUrl, '/api/application-profile', {
        method: 'POST',
        cookie: user1.cookie,
        body: { expected_salary: 50000, minimum_acceptable_salary: 80000 },
      })
      assert.equal(res2.status, 400)

      // Invalid experience level
      const res3 = await request(baseUrl, '/api/application-profile', {
        method: 'POST',
        cookie: user1.cookie,
        body: { experience_level: 'super-senior' },
      })
      assert.equal(res3.status, 400)
    })

    await t.test('creates and retrieves full application profile', async () => {
      const profilePayload = {
        headline: 'Senior Full Stack Engineer',
        current_job_title: 'Full Stack Developer',
        professional_introduction: 'Passionate software engineer with 6 years building web apps.',
        skills: ['JavaScript', 'React', 'Node.js', 'PostgreSQL'],
        experience_level: 'senior',
        years_of_experience: 6.5,
        joining_status: 'serving_notice',
        notice_period_days: 30,
        available_from: '2026-11-01',
        willing_to_relocate: true,
        expected_salary: 120000,
        minimum_acceptable_salary: 100000,
        salary_currency: 'USD',
        salary_period: 'yearly',
        preferred_roles: ['Senior Frontend Developer', 'Full Stack Engineer'],
        preferred_locations: ['San Francisco', 'Remote', 'New York'],
        remote_preference: 'hybrid',
        employment_types: ['full-time'],
        preferred_industries: ['Software', 'FinTech'],
        work_authorization: 'Authorized to work without sponsorship',
        shift_availability: 'day',
        relocation_preference: 'open',
        custom_answers: { linkedin_url: 'https://linkedin.com/in/demo' },
      }

      const saveRes = await request(baseUrl, '/api/application-profile', {
        method: 'POST',
        cookie: user1.cookie,
        body: profilePayload,
      })
      assert.equal(saveRes.status, 200)
      const saveData = await saveRes.json()
      assert.equal(saveData.ok, true)
      assert.equal(saveData.profile.headline, profilePayload.headline)
      assert.equal(saveData.profile.skills.length, 4)
      assert.equal(Number(saveData.profile.years_of_experience), 6.5)
      assert.equal(saveData.profile.joining_status, 'serving_notice')
      assert.equal(saveData.profile.notice_period_days, 30)
      assert.equal(Number(saveData.profile.expected_salary), 120000)
      assert.equal(saveData.profile.salary_currency, 'USD')

      // Get profile
      const getRes = await request(baseUrl, '/api/application-profile', { cookie: user1.cookie })
      assert.equal(getRes.status, 200)
      const getData = await getRes.json()
      assert.equal(getData.profile.user_id, user1.user.id)
      assert.equal(getData.completeness.completenessScore, 90) // 90 because no resume yet (+10 with resume)
    })

    await t.test('updates profile partially via PATCH', async () => {
      const patchRes = await request(baseUrl, '/api/application-profile', {
        method: 'PATCH',
        cookie: user1.cookie,
        body: {
          headline: 'Lead Platform Architect',
          expected_salary: 140000,
        },
      })
      assert.equal(patchRes.status, 200)
      const patchData = await patchRes.json()
      assert.equal(patchData.profile.headline, 'Lead Platform Architect')
      assert.equal(Number(patchData.profile.expected_salary), 140000)
      // Preserves existing skills
      assert.equal(patchData.profile.skills.length, 4)
    })

    await t.test('user isolation: user 2 has separate empty profile and cannot access user 1 profile', async () => {
      const user2Res = await request(baseUrl, '/api/application-profile', { cookie: user2.cookie })
      assert.equal(user2Res.status, 200)
      const user2Data = await user2Res.json()
      assert.equal(user2Data.profile, null)
    })
  })
}
