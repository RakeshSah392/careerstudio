/**
 * TechNova Job Application Assistant
 * Step 11.4 — Auto-Apply Queue & External Application Routing Test Suite
 */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'
import { autoApplyEligibilityService } from '../services/autoApply/eligibilityService.js'

if (!databaseConfigured) {
  test('Step 11.4 tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const deliveredCodes = new Map()
  const userIds = []
  const createdJobIds = []

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

  async function signIn(baseUrl, email, fullName, role = 'job_seeker') {
    const otpRes = await request(baseUrl, '/api/auth/otp/request', {
      method: 'POST',
      body: { email },
    })
    assert.equal(otpRes.status, 202)
    const code = deliveredCodes.get(email)
    assert.ok(code)
    const verifyRes = await request(baseUrl, '/api/auth/otp/verify', {
      method: 'POST',
      body: { email, code, full_name: fullName },
    })
    assert.equal(verifyRes.status, 200)
    const { user } = await verifyRes.json()
    const setCookie = verifyRes.headers.get('set-cookie')
    userIds.push(user.id)

    if (role !== 'job_seeker') {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id])
      user.role = role
    }

    return { user, cookie: setCookie.split(';', 1)[0] }
  }

  test('Step 11.4 — Auto-Apply Queue & External Application Routing', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })

    const server = app.listen(0)
    await once(server, 'listening')
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`

    // Setup: Create Seeker and Recruiter
    const seeker = await signIn(baseUrl, `seeker114-${suffix}@example.invalid`, 'Auto Seeker', 'job_seeker')
    const recruiter = await signIn(baseUrl, `recruiter114-${suffix}@example.invalid`, 'Recruiter Jane', 'employer')

    // 1. Create Recruiter Internal Job
    const jobRes = await request(baseUrl, '/api/jobs', {
      method: 'POST',
      cookie: recruiter.cookie,
      body: {
        company: `NovaTech Enterprise ${suffix}`,
        title: 'Senior DevOps Architect',
        location: 'Bengaluru, India',
        remote_type: 'remote',
        employment_type: 'full-time',
        industry: 'Infrastructure',
        description: 'Lead Kubernetes and cloud infrastructure.',
        salary_min: 2500000,
        salary_max: 3500000,
        currency: 'INR',
        status: 'open',
        posted_at: '2026-10-02',
      },
    })
    assert.equal(jobRes.status, 201)
    const internalJob = await jobRes.json()
    createdJobIds.push(internalJob.id)

    t.after(async () => {
      server.close()
      if (createdJobIds.length) {
        await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobIds])
      }
      if (userIds.length) {
        await pool.query('DELETE FROM auto_apply_queue WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM applications WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM auto_apply_settings WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM application_profiles WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM resumes WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM job_preferences WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds])
      }
    })

    await t.test('1. Eligibility: Strict Rejection Rules', () => {
      // Rule 1: Auto-Apply OFF
      const res1 = autoApplyEligibilityService.evaluate({
        user: { id: seeker.user.id },
        profile: { headline: 'DevOps', skills: ['AWS'] },
        autoApplySettings: { enabled: false, minimum_match_percentage: 80 },
        primaryResume: { id: 'res-1' },
        job: { status: 'open', remote_type: 'remote' },
        matchScore: 90,
      })
      assert.equal(res1.eligible, false)
      assert.ok(res1.reasons.some((r) => r.includes('turned OFF')))

      // Rule 2: External Job disqualified from internal auto-submission
      const res2 = autoApplyEligibilityService.evaluate({
        user: { id: seeker.user.id },
        profile: { headline: 'DevOps', skills: ['AWS'] },
        autoApplySettings: { enabled: true, minimum_match_percentage: 80 },
        primaryResume: { id: 'res-1' },
        job: { status: 'open', is_external: true, source: 'adzuna' },
        matchScore: 95,
      })
      assert.equal(res2.eligible, false)
      assert.ok(res2.reasons.some((r) => r.includes('External aggregated jobs cannot be auto-submitted')))

      // Rule 3: Below Match Threshold
      const res3 = autoApplyEligibilityService.evaluate({
        user: { id: seeker.user.id },
        profile: { headline: 'DevOps', skills: ['AWS'] },
        autoApplySettings: { enabled: true, minimum_match_percentage: 85 },
        primaryResume: { id: 'res-1' },
        job: { status: 'open', remote_type: 'remote', is_external: false },
        matchScore: 75,
      })
      assert.equal(res3.eligible, false)
      assert.ok(res3.reasons.some((r) => r.includes('does not meet candidate threshold')))

      // Rule 4: No Primary Resume
      const res4 = autoApplyEligibilityService.evaluate({
        user: { id: seeker.user.id },
        profile: { headline: 'DevOps', skills: ['AWS'] },
        autoApplySettings: { enabled: true, minimum_match_percentage: 80, require_resume: true },
        primaryResume: null,
        job: { status: 'open', remote_type: 'remote', is_external: false },
        matchScore: 90,
      })
      assert.equal(res4.eligible, false)
      assert.ok(res4.reasons.some((r) => r.includes('primary resume is required')))
    })

    await t.test('2. Complete Profile & Enable Auto-Apply', async () => {
      // Upload Primary Resume
      const resumeRes = await pool.query(
        `INSERT INTO resumes (user_id, title, content_text, is_primary)
         VALUES ($1, 'DevOps Resume', 'Kubernetes, Terraform, AWS, Docker expert.', true)
         RETURNING id`,
        [seeker.user.id],
      )
      assert.ok(resumeRes.rowCount > 0)

      // Save Full Application Profile
      const profileRes = await request(baseUrl, '/api/application-profile', {
        method: 'POST',
        cookie: seeker.cookie,
        body: {
          headline: 'Senior DevOps Architect',
          current_job_title: 'DevOps Engineer',
          years_of_experience: 7,
          experience_level: 'senior',
          skills: ['Kubernetes', 'Docker', 'AWS', 'Terraform', 'CI/CD'],
          location: 'Bengaluru, India',
          work_authorization: 'Authorized to work in India',
          joining_status: 'immediate',
          expected_salary: 2500000,
          minimum_acceptable_salary: 2000000,
        },
      })
      assert.equal(profileRes.status, 200)

      // Save Job Preferences
      await pool.query(
        `INSERT INTO job_preferences (user_id, target_roles, locations, remote_preference, min_salary, max_salary, employment_types, industries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET target_roles = EXCLUDED.target_roles`,
        [
          seeker.user.id,
          ['Senior DevOps Architect', 'DevOps Engineer'],
          ['Bengaluru, India', 'Remote'],
          'any',
          2000000,
          4000000,
          ['full-time'],
          ['Infrastructure'],
        ],
      )

      // Enable Auto-Apply
      const settingsRes = await request(baseUrl, '/api/auto-apply/settings', {
        method: 'PATCH',
        cookie: seeker.cookie,
        body: {
          enabled: true,
          minimum_match_percentage: 75,
          allowed_work_modes: ['remote', 'hybrid', 'onsite'],
        },
      })
      assert.equal(settingsRes.status, 200)
      const settingsData = await settingsRes.json()
      assert.equal(settingsData.settings.enabled, true)
    })

    await t.test('3. Status Endpoint Reports Complete Profile & Enabled Queue', async () => {
      const statusRes = await request(baseUrl, '/api/auto-apply/status', {
        cookie: seeker.cookie,
      })
      assert.equal(statusRes.status, 200)
      const data = await statusRes.json()
      assert.equal(data.ok, true)
      assert.equal(data.settings.enabled, true)
      assert.equal(data.profile.isComplete, true)
      assert.equal(data.profile.hasPrimaryResume, true)
    })

    await t.test('4. Idempotent Auto-Apply Execution & Recruiter Notification', async () => {
      // First Request: Successfully queues and executes application
      const applyRes1 = await request(baseUrl, `/api/auto-apply/queue/${internalJob.id}`, {
        method: 'POST',
        cookie: seeker.cookie,
      })
      assert.equal(applyRes1.status, 200)
      const data1 = await applyRes1.json()
      assert.equal(data1.ok, true)
      assert.equal(data1.eligible, true)
      assert.equal(data1.queue_item.status, 'applied')
      assert.ok(data1.application.id)
      assert.equal(data1.application.source, 'auto_apply')

      // Verify Application exists in normal applications table
      const appCheck = await pool.query('SELECT * FROM applications WHERE id = $1', [data1.application.id])
      assert.equal(appCheck.rowCount, 1)
      assert.equal(appCheck.rows[0].status, 'Applied')

      // Verify Recruiter Notification received
      const notifCheck = await pool.query(
        'SELECT * FROM notifications WHERE user_id = $1 AND related_job_id = $2',
        [recruiter.user.id, internalJob.id],
      )
      assert.equal(notifCheck.rowCount, 1)
      assert.ok(notifCheck.rows[0].message.includes('applied for "Senior DevOps Architect"'))

      // Second Request (Idempotent): Does not duplicate application or notification
      const applyRes2 = await request(baseUrl, `/api/auto-apply/queue/${internalJob.id}`, {
        method: 'POST',
        cookie: seeker.cookie,
      })
      assert.equal(applyRes2.status, 200)
      const data2 = await applyRes2.json()
      assert.equal(data2.ok, true)
      assert.equal(data2.already_applied, true)

      const appCountCheck = await pool.query(
        'SELECT COUNT(*)::int AS count FROM applications WHERE user_id = $1 AND job_id = $2',
        [seeker.user.id, internalJob.id],
      )
      assert.equal(appCountCheck.rows[0].count, 1)

      const notifCountCheck = await pool.query(
        'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND related_job_id = $2',
        [recruiter.user.id, internalJob.id],
      )
      assert.equal(notifCountCheck.rows[0].count, 1)
    })

    await t.test('5. Standardized Provider-Neutral Candidate Export', async () => {
      const exportRes = await request(baseUrl, `/api/auto-apply/export/${internalJob.id}`, {
        method: 'POST',
        cookie: seeker.cookie,
      })
      assert.equal(exportRes.status, 200)
      const { payload } = await exportRes.json()

      assert.equal(payload.schema_version, '1.0.0')
      assert.equal(payload.candidate.full_name, 'Auto Seeker')
      assert.equal(payload.candidate.email, `seeker114-${suffix}@example.invalid`)
      assert.ok(Array.isArray(payload.profile.skills))
      assert.ok(payload.profile.skills.includes('Kubernetes'))
      assert.ok(payload.resume.content_text.includes('Kubernetes'))
      assert.equal(payload.common_answers.authorized_to_work, 'authorized')
      // Verify no sensitive keys leaked
      assert.equal(payload.password, undefined)
      assert.equal(payload.token, undefined)
    })

    await t.test('6. External Job Routing & Click Tracking (No Fake Submissions)', async () => {
      const clickRes = await request(baseUrl, '/api/auto-apply/external/ext-123-fake/open-track', {
        method: 'POST',
        cookie: seeker.cookie,
        body: {
          source: 'adzuna',
          source_url: 'https://adzuna.com/details/99901',
        },
      })
      assert.equal(clickRes.status, 200)
      const clickData = await clickRes.json()
      assert.equal(clickData.ok, true)
      assert.equal(clickData.tracked, true)
      assert.equal(clickData.source, 'adzuna')

      // Verify no fake application was created in applications table for this external link
      const fakeAppCheck = await pool.query(
        'SELECT * FROM applications WHERE user_id = $1 AND source_url = $2',
        [seeker.user.id, 'https://adzuna.com/details/99901'],
      )
      assert.equal(fakeAppCheck.rowCount, 0)
    })
  })
}
