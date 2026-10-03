import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from './app.js'
import { databaseConfigured, pool } from './db.js'

if (!databaseConfigured) throw new Error('DATABASE_URL is required for the auth integration flow.')

const suffix = Date.now()
const identities = [
  { email: `auth-flow-a-${suffix}@example.invalid`, fullName: 'Temporary Auth Test A' },
  { email: `auth-flow-b-${suffix}@example.invalid`, fullName: 'Temporary Auth Test B' },
  { email: `auth-flow-expired-${suffix}@example.invalid`, fullName: 'Temporary Auth Test Expired' },
  { email: `auth-flow-attempts-${suffix}@example.invalid`, fullName: 'Temporary Auth Test Attempts' },
]
const deliveredCodes = new Map()
const userIds = []
const jobIds = []
const resumeIds = []
let server
let results

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
  const otpResponse = await request(baseUrl, '/api/auth/otp/request', {
    method: 'POST',
    body: { email: identity.email },
  })
  assert.equal(otpResponse.status, 202)
  const code = deliveredCodes.get(identity.email)
  assert.match(code ?? '', /^\d{6}$/)
  const verifyResponse = await request(baseUrl, '/api/auth/otp/verify', {
    method: 'POST',
    body: { email: identity.email, code, full_name: identity.fullName },
  })
  assert.equal(verifyResponse.status, 200)
  const { user } = await verifyResponse.json()
  const setCookie = verifyResponse.headers.get('set-cookie')
  assert.ok(setCookie)
  userIds.push(user.id)
  return { user, code, cookie: setCookie.split(';', 1)[0] }
}

async function removeRows(sql, values) {
  const result = await pool.query(sql, values)
  return result.rowCount
}

try {
  const app = createApp({
    canDeliverOtp: () => true,
    sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
  })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const first = await signIn(baseUrl, identities[0])
  assert.equal((await request(baseUrl, '/api/auth/me', { cookie: first.cookie })).status, 200)
  assert.equal((await request(baseUrl, '/api/applications')).status, 401)
  assert.equal((await request(baseUrl, '/api/jobs', { method: 'POST', body: { company: 'No auth', title: 'Blocked' } })).status, 401)
  assert.equal((await request(baseUrl, '/api/users', { method: 'POST', body: identities[0] })).status, 401)

  const replayResponse = await request(baseUrl, '/api/auth/otp/verify', {
    method: 'POST',
    body: { email: identities[0].email, code: first.code, full_name: identities[0].fullName },
  })
  assert.equal(replayResponse.status, 401, 'Consumed OTP cannot be reused')

  const second = await signIn(baseUrl, identities[1])
  assert.equal((await request(baseUrl, `/api/users/${first.user.id}`, { cookie: second.cookie })).status, 403)
  assert.equal((await request(baseUrl, `/api/preferences/${first.user.id}`, { cookie: second.cookie })).status, 403)
  assert.equal((await request(baseUrl, '/api/preferences', {
    method: 'POST',
    cookie: second.cookie,
    body: { user_id: first.user.id, target_roles: ['Engineer'] },
  })).status, 403)

  const expiredRequest = await request(baseUrl, '/api/auth/otp/request', {
    method: 'POST',
    body: { email: identities[2].email },
  })
  assert.equal(expiredRequest.status, 202)
  const expiredCode = deliveredCodes.get(identities[2].email)
  await pool.query(
    "UPDATE otp_challenges SET expires_at = NOW() - INTERVAL '1 second' WHERE email = $1 AND consumed_at IS NULL",
    [identities[2].email],
  )
  const expiredVerify = await request(baseUrl, '/api/auth/otp/verify', {
    method: 'POST',
    body: { email: identities[2].email, code: expiredCode, full_name: identities[2].fullName },
  })
  assert.equal(expiredVerify.status, 401, 'Expired OTP cannot create a session')

  const attemptsRequest = await request(baseUrl, '/api/auth/otp/request', {
    method: 'POST',
    body: { email: identities[3].email },
  })
  assert.equal(attemptsRequest.status, 202)
  const attemptsCode = deliveredCodes.get(identities[3].email)
  const wrongCode = attemptsCode === '000000' ? '000001' : '000000'
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invalidResponse = await request(baseUrl, '/api/auth/otp/verify', {
      method: 'POST',
      body: { email: identities[3].email, code: wrongCode, full_name: identities[3].fullName },
    })
    assert.equal(invalidResponse.status, 401)
  }
  const lockedVerify = await request(baseUrl, '/api/auth/otp/verify', {
    method: 'POST',
    body: { email: identities[3].email, code: attemptsCode, full_name: identities[3].fullName },
  })
  assert.equal(lockedVerify.status, 401, 'Challenge locks after five attempts')

  // Verify job seeker cannot post jobs
  const seekerJobResponse = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    cookie: first.cookie,
    body: { company: 'Seeker Corp', title: 'Unauthorized Role' },
  })
  assert.equal(seekerJobResponse.status, 403, 'Job seeker cannot create job listings')

  // Onboard first user as employer
  const onboardRes = await request(baseUrl, '/api/employer/onboard', {
    method: 'POST',
    cookie: first.cookie,
    body: {
      company_name: 'Flow Technologies',
      recruiter_name: first.user.full_name,
      recruiter_email: first.user.email,
    },
  })
  assert.equal(onboardRes.status, 200, 'User successfully onboards as employer')

  const company = `Temporary Auth Flow Job ${suffix}`
  const jobResponse = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    cookie: first.cookie,
    body: { company, title: 'Auth Flow Test Role', created_by_user_id: first.user.id },
  })
  assert.equal(jobResponse.status, 201)
  const job = await jobResponse.json()
  jobIds.push(job.id)

  const publicJobResponse = await request(baseUrl, `/api/jobs/${job.id}`)
  assert.equal(publicJobResponse.status, 200, 'Anonymous visitors can view open jobs')
  const publicList = await request(baseUrl, `/api/jobs?status=all&q=${encodeURIComponent(company)}`)
  assert.equal(publicList.status, 200)
  assert.equal((await request(baseUrl, `/api/jobs/${job.id}`, { method: 'PATCH', cookie: second.cookie, body: { status: 'closed' } })).status, 403, 'Job seeker cannot modify jobs')

  const preferenceResponse = await request(baseUrl, '/api/preferences', {
    method: 'POST',
    cookie: first.cookie,
    body: { user_id: first.user.id, target_roles: ['Engineer'] },
  })
  assert.equal(preferenceResponse.status, 201)

  const resumeResponse = await request(baseUrl, '/api/resumes', {
    method: 'POST',
    cookie: first.cookie,
    body: { user_id: first.user.id, title: 'Auth Flow Resume', content_text: 'Temporary test resume.' },
  })
  assert.equal(resumeResponse.status, 201)
  const resume = await resumeResponse.json()
  resumeIds.push(resume.id)
  assert.equal((await request(baseUrl, `/api/resumes/${resume.id}`, { cookie: second.cookie })).status, 404)

  const applicationResponse = await request(baseUrl, '/api/applications', {
    method: 'POST',
    cookie: first.cookie,
    body: { user_id: first.user.id, job_id: job.id },
  })
  assert.equal(applicationResponse.status, 201)
  const application = await applicationResponse.json()
  assert.equal((await request(baseUrl, `/api/applications/${application.id}`, { cookie: second.cookie })).status, 404)
  assert.equal((await request(baseUrl, `/api/matches?user_id=${first.user.id}`, { cookie: second.cookie })).status, 403)

  const closedResponse = await request(baseUrl, `/api/jobs/${job.id}`, {
    method: 'PATCH',
    cookie: first.cookie,
    body: { status: 'closed' },
  })
  assert.equal(closedResponse.status, 200)
  assert.equal((await request(baseUrl, `/api/jobs/${job.id}`)).status, 404, 'Anonymous visitors cannot view closed jobs')

  assert.equal((await request(baseUrl, '/api/auth/logout', { method: 'POST', cookie: first.cookie })).status, 204)
  assert.equal((await request(baseUrl, '/api/auth/me', { cookie: first.cookie })).status, 401)
  await request(baseUrl, '/api/auth/logout', { method: 'POST', cookie: second.cookie })
  results = { otpSignIn: 'passed', oneTimeCode: 'passed', expiry: 'passed', attemptLimit: 'passed', privateResourceIsolation: 'passed', publicOpenJobs: 'passed' }
} catch (error) {
  console.error(JSON.stringify({ integrationTest: 'failed', message: error.message }))
  process.exitCode = 1
} finally {
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  const emails = identities.map((identity) => identity.email)
  const cleanupResults = {}
  try {
    cleanupResults.applications = await removeRows('DELETE FROM applications WHERE user_id = ANY($1::uuid[]) RETURNING id', [userIds])
    cleanupResults.matches = await removeRows('DELETE FROM job_matches WHERE user_id = ANY($1::uuid[]) RETURNING id', [userIds])
    cleanupResults.preferences = await removeRows('DELETE FROM job_preferences WHERE user_id = ANY($1::uuid[]) RETURNING id', [userIds])
    cleanupResults.resumes = await removeRows('DELETE FROM resumes WHERE user_id = ANY($1::uuid[]) RETURNING id', [userIds])
    cleanupResults.jobs = await removeRows('DELETE FROM jobs WHERE id = ANY($1::uuid[]) RETURNING id', [jobIds])
    cleanupResults.challenges = await removeRows('DELETE FROM otp_challenges WHERE email = ANY($1::text[]) RETURNING id', [emails])
    cleanupResults.sessions = await removeRows("DELETE FROM user_sessions WHERE sess ->> 'userId' = ANY($1::text[]) RETURNING sid", [userIds])
    cleanupResults.users = await removeRows('DELETE FROM users WHERE id = ANY($1::uuid[]) RETURNING id', [userIds])
  } catch (error) {
    console.error(JSON.stringify({ cleanup: 'failed', code: error.code ?? null }))
    process.exitCode = 1
  }
  console.log(JSON.stringify({ ...results, cleanup: cleanupResults }))
  await pool.end()
}