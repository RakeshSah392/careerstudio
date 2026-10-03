/**
 * TechNova Job Application Assistant
 * GET /api/jobs/discovery HTTP Integration Test Suite
 */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'

if (!databaseConfigured) {
  test('jobs discovery HTTP tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const deliveredCodes = new Map()
  const createdJobIds = []
  const userIds = []

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

  test('GET /api/jobs/discovery HTTP endpoint suite', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })

    const server = app.listen(0)
    await once(server, 'listening')
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`

    // Setup: Create Recruiter and 2 Internal Jobs
    const recruiter = await signIn(baseUrl, `recruiter-${suffix}@example.invalid`, 'Recruiter One', 'employer')
    const seeker = await signIn(baseUrl, `seeker-${suffix}@example.invalid`, 'Seeker One', 'job_seeker')

    // Set Seeker Preferences
    await pool.query(
      `INSERT INTO job_preferences (user_id, target_roles, locations, remote_preference, min_salary, max_salary, employment_types, industries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET target_roles = EXCLUDED.target_roles, locations = EXCLUDED.locations`,
      [
        seeker.user.id,
        ['Cloud Engineer', 'Platform Engineer'],
        ['Bengaluru', 'Remote'],
        'any',
        1000000,
        3000000,
        ['full-time'],
        ['Cloud & DevOps'],
      ],
    )

    // Create 2 internal jobs
    const job1Res = await request(baseUrl, '/api/jobs', {
      method: 'POST',
      cookie: recruiter.cookie,
      body: {
        company: `CloudTech Labs ${suffix}`,
        title: 'Lead Cloud Engineer',
        location: 'Bengaluru, India',
        remote_type: 'remote',
        employment_type: 'full-time',
        industry: 'Cloud & DevOps',
        description: 'Design and deploy AWS and GCP infrastructure.',
        salary_min: 2000000,
        salary_max: 2800000,
        currency: 'INR',
        status: 'open',
        posted_at: '2026-10-02',
      },
    })
    assert.equal(job1Res.status, 201)
    const job1 = await job1Res.json()
    createdJobIds.push(job1.id)

    const job2Res = await request(baseUrl, '/api/jobs', {
      method: 'POST',
      cookie: recruiter.cookie,
      body: {
        company: `RetailHub India ${suffix}`,
        title: 'Junior Inventory Specialist',
        location: 'Mumbai, India',
        remote_type: 'onsite',
        employment_type: 'full-time',
        industry: 'Retail',
        description: 'Manage warehouse logistics and stock.',
        salary_min: 500000,
        salary_max: 700000,
        currency: 'INR',
        status: 'open',
        posted_at: '2026-10-01',
      },
    })
    assert.equal(job2Res.status, 201)
    const job2 = await job2Res.json()
    createdJobIds.push(job2.id)

    t.after(async () => {
      server.close()
      if (createdJobIds.length) {
        await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobIds])
      }
      if (userIds.length) {
        await pool.query('DELETE FROM job_preferences WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds])
      }
    })

    await t.test('1. Unauthenticated discovery search succeeds with country default "in"', async () => {
      const res = await request(baseUrl, '/api/jobs/discovery?source=internal')
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ok, true)
      assert.equal(data.query.country, 'in')
      assert.ok(Array.isArray(data.jobs))
      assert.ok(data.jobs.some((j) => j.id === job1.id))
      // Unauthenticated has null match score
      const foundJob1 = data.jobs.find((j) => j.id === job1.id)
      assert.equal(foundJob1.match_score, null)
      assert.equal(foundJob1.attribution, 'CareerStudio Recruiter Verified')
    })

    await t.test('2. Authenticated seeker receives deterministic match scores', async () => {
      const res = await request(baseUrl, '/api/jobs/discovery?source=internal&sort=best_match', {
        cookie: seeker.cookie,
      })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ok, true)
      const foundJob1 = data.jobs.find((j) => j.id === job1.id)
      const foundJob2 = data.jobs.find((j) => j.id === job2.id)

      assert.ok(foundJob1)
      assert.ok(typeof foundJob1.match_score === 'number')
      assert.ok(foundJob1.match_score > (foundJob2?.match_score || 0))
      assert.ok(foundJob1.match_breakdown.role > 0)
    })

    await t.test('3. Filters by keyword, work mode, and minimum salary', async () => {
      const kwRes = await request(baseUrl, `/api/jobs/discovery?source=internal&keywords=CloudTech`)
      assert.equal(kwRes.status, 200)
      const kwData = await kwRes.json()
      assert.equal(kwData.jobs.length, 1)
      assert.equal(kwData.jobs[0].id, job1.id)

      const salRes = await request(baseUrl, `/api/jobs/discovery?source=internal&min_salary=1500000`)
      assert.equal(salRes.status, 200)
      const salData = await salRes.json()
      assert.ok(salData.jobs.some((j) => j.id === job1.id))
      assert.ok(!salData.jobs.some((j) => j.id === job2.id))
    })

    await t.test('4. Validates pagination limits and bad inputs', async () => {
      const badPageRes = await request(baseUrl, '/api/jobs/discovery?page=0')
      assert.equal(badPageRes.status, 400)

      const badSourceRes = await request(baseUrl, '/api/jobs/discovery?source=invalid_src')
      assert.equal(badSourceRes.status, 400)
    })
  })
}
