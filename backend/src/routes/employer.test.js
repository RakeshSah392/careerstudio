import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('employer tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const jobSeekerIdentity = { email: `employer-test-seeker-${suffix}@example.invalid`, fullName: 'Seeker Test User' }
  const employerIdentity = { email: `employer-test-emp-${suffix}@example.invalid`, fullName: 'Employer Test User' }
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

  test('employer onboarding and profile management suite', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    try {
      // 1. Unauthenticated requests blocked
      await t.test('unauthenticated access to employer routes returns 401', async () => {
        const resOnboard = await request(baseUrl, '/api/employer/onboard', {
          method: 'POST',
          body: { company_name: 'Acme', recruiter_name: 'Alice', recruiter_email: 'alice@acme.invalid' },
        })
        assert.equal(resOnboard.status, 401)

        const resGet = await request(baseUrl, '/api/employer/profile')
        assert.equal(resGet.status, 401)

        const resPatch = await request(baseUrl, '/api/employer/profile', {
          method: 'PATCH',
          body: { company_name: 'Acme Corp' },
        })
        assert.equal(resPatch.status, 401)
      })

      // 2. Sign in as Job Seeker
      const seeker = await signIn(baseUrl, jobSeekerIdentity)
      assert.equal(seeker.user.role, 'job_seeker')

      // 3. Job seeker cannot access employer-only profile endpoints before onboarding
      await t.test('job seeker blocked from GET /profile and PATCH /profile with 403', async () => {
        const getRes = await request(baseUrl, '/api/employer/profile', { cookie: seeker.cookie })
        assert.equal(getRes.status, 403)
        const getBody = await getRes.json()
        assert.equal(getBody.error, 'Access denied. Required role not granted.')

        const patchRes = await request(baseUrl, '/api/employer/profile', {
          method: 'PATCH',
          cookie: seeker.cookie,
          body: { company_name: 'Hacked Inc' },
        })
        assert.equal(patchRes.status, 403)
      })

      // 4. Onboarding validation
      await t.test('onboard rejects invalid or incomplete payloads with 400', async () => {
        const resMissing = await request(baseUrl, '/api/employer/onboard', {
          method: 'POST',
          cookie: seeker.cookie,
          body: { company_name: 'Acme' }, // missing recruiter_name & recruiter_email
        })
        assert.equal(resMissing.status, 400)

        const resInvalidEmail = await request(baseUrl, '/api/employer/onboard', {
          method: 'POST',
          cookie: seeker.cookie,
          body: {
            company_name: 'Acme Corp',
            recruiter_name: 'Alice',
            recruiter_email: 'not-an-email',
          },
        })
        assert.equal(resInvalidEmail.status, 400)
      })

      // 5. Successful onboarding (job_seeker -> employer transition)
      await t.test('onboard creates employer profile and transitions role to employer', async () => {
        const onboardRes = await request(baseUrl, '/api/employer/onboard', {
          method: 'POST',
          cookie: seeker.cookie,
          body: {
            company_name: 'TechNova Global',
            company_website: 'https://technova.example.com',
            company_description: 'Building next-gen AI tools.',
            recruiter_name: 'Sarah Connor',
            recruiter_email: 'sarah@technova.example.com',
            recruiter_phone: '+1 555-0199',
          },
        })
        assert.equal(onboardRes.status, 200)
        const data = await onboardRes.json()
        assert.equal(data.user.role, 'employer')
        assert.equal(data.profile.company_name, 'TechNova Global')
        assert.equal(data.profile.recruiter_name, 'Sarah Connor')
        assert.equal(data.profile.recruiter_email, 'sarah@technova.example.com')
        assert.equal(data.profile.recruiter_phone, '+1 555-0199')
        assert.equal(data.profile.user_id, seeker.user.id)

        // Verify auth/me now reflects employer role
        const meRes = await request(baseUrl, '/api/auth/me', { cookie: seeker.cookie })
        assert.equal(meRes.status, 200)
        const meData = await meRes.json()
        assert.equal(meData.user.role, 'employer')
      })

      // 6. Employer can retrieve own profile
      await t.test('employer can retrieve own profile via GET /api/employer/profile', async () => {
        const profileRes = await request(baseUrl, '/api/employer/profile', { cookie: seeker.cookie })
        assert.equal(profileRes.status, 200)
        const { profile } = await profileRes.json()
        assert.equal(profile.company_name, 'TechNova Global')
        assert.equal(profile.company_website, 'https://technova.example.com')
      })

      // 7. Employer can update profile via PATCH /api/employer/profile
      await t.test('employer can update profile via PATCH /api/employer/profile', async () => {
        const updateRes = await request(baseUrl, '/api/employer/profile', {
          method: 'PATCH',
          cookie: seeker.cookie,
          body: {
            company_name: 'TechNova Technologies Ltd',
            recruiter_phone: '+1 555-0200',
          },
        })
        assert.equal(updateRes.status, 200)
        const { profile } = await updateRes.json()
        assert.equal(profile.company_name, 'TechNova Technologies Ltd')
        assert.equal(profile.recruiter_phone, '+1 555-0200')
        assert.equal(profile.company_description, 'Building next-gen AI tools.')
      })

      // 8. Cross-user isolation
      const secondUser = await signIn(baseUrl, employerIdentity)
      await t.test('user isolation: second user cannot view first user employer profile', async () => {
        const getRes = await request(baseUrl, '/api/employer/profile', { cookie: secondUser.cookie })
        assert.equal(getRes.status, 403, 'Second user (still job seeker) cannot access profile endpoint')

        // Onboard second user as a separate employer
        const secondOnboard = await request(baseUrl, '/api/employer/onboard', {
          method: 'POST',
          cookie: secondUser.cookie,
          body: {
            company_name: 'Nexus Corp',
            recruiter_name: 'John Smith',
            recruiter_email: 'john@nexus.example.com',
          },
        })
        assert.equal(secondOnboard.status, 200)
        const secondData = await secondOnboard.json()
        assert.equal(secondData.profile.company_name, 'Nexus Corp')

        // First user's profile remains untouched
        const firstProfileRes = await request(baseUrl, '/api/employer/profile', { cookie: seeker.cookie })
        const { profile: firstProfile } = await firstProfileRes.json()
        assert.equal(firstProfile.company_name, 'TechNova Technologies Ltd')
        assert.equal(firstProfile.user_id, seeker.user.id)
      })

    } finally {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))

      // Cleanup test data
      if (userIds.length) {
        await pool.query('DELETE FROM employer_profiles WHERE user_id = ANY($1::uuid[])', [userIds])
        await pool.query('DELETE FROM otp_challenges WHERE email IN ($1, $2)', [jobSeekerIdentity.email, employerIdentity.email])
        await pool.query("DELETE FROM user_sessions WHERE sess ->> 'userId' = ANY($1::text[])", [userIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds])
      }
    }
  })
}
