import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured, pool } from '../db.js'
import { aiService, RAGContextAssembler } from '../services/ai/aiContracts.js'
import { autoApplyService } from '../services/autoApplyService.js'
import {
  classifyQuestion,
  extractStructuredAnswer,
  QuestionCategory,
  resolveApplicationQuestion,
} from '../services/questionAnsweringContract.js'

if (!databaseConfigured) {
  test('auto apply tests skipped (no database)', { skip: true }, () => {})
} else {
  const suffix = Date.now()
  const user1Identity = { email: `auto-app-user1-${suffix}@example.invalid`, fullName: 'Auto User One' }
  const user2Identity = { email: `auto-app-user2-${suffix}@example.invalid`, fullName: 'Auto User Two' }
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

  test('auto apply settings and domain evaluation test suite', async (t) => {
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
        await pool.query('DELETE FROM auto_apply_settings WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds])
      }
    })

    const user1 = await signIn(baseUrl, user1Identity)
    const user2 = await signIn(baseUrl, user2Identity)

    await t.test('unauthenticated access returns 401', async () => {
      const res = await request(baseUrl, '/api/auto-apply')
      assert.equal(res.status, 401)
    })

    await t.test('returns default settings with auto-apply OFF for fresh account', async () => {
      const res = await request(baseUrl, '/api/auto-apply', { cookie: user1.cookie })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ok, true)
      assert.equal(data.settings.enabled, false)
      assert.equal(data.settings.minimum_match_percentage, 80)
      assert.equal(data.settings.require_resume, true)
      assert.equal(data.settings.require_complete_profile, true)
    })

    await t.test('rejects invalid auto-apply settings', async () => {
      // Out of bounds threshold
      const res1 = await request(baseUrl, '/api/auto-apply', {
        method: 'PATCH',
        cookie: user1.cookie,
        body: { minimum_match_percentage: 150 },
      })
      assert.equal(res1.status, 400)

      // Invalid work mode
      const res2 = await request(baseUrl, '/api/auto-apply', {
        method: 'PATCH',
        cookie: user1.cookie,
        body: { allowed_work_modes: ['outer-space'] },
      })
      assert.equal(res2.status, 400)
    })

    await t.test('updates auto-apply settings via PATCH', async () => {
      const patchRes = await request(baseUrl, '/api/auto-apply', {
        method: 'PATCH',
        cookie: user1.cookie,
        body: {
          enabled: true,
          minimum_match_percentage: 85,
          allowed_work_modes: ['remote', 'hybrid'],
        },
      })
      assert.equal(patchRes.status, 200)
      const patchData = await patchRes.json()
      assert.equal(patchData.ok, true)
      assert.equal(patchData.settings.enabled, true)
      assert.equal(patchData.settings.minimum_match_percentage, 85)
      assert.deepEqual(patchData.settings.allowed_work_modes, ['remote', 'hybrid'])
    })

    await t.test('user isolation: user 2 still has default settings and enabled: false', async () => {
      const user2Res = await request(baseUrl, '/api/auto-apply', { cookie: user2.cookie })
      assert.equal(user2Res.status, 200)
      const user2Data = await user2Res.json()
      assert.equal(user2Data.settings.enabled, false)
      assert.equal(user2Data.settings.minimum_match_percentage, 80)
    })

    // Pure Domain Evaluation Tests
    await t.test('autoApplyService evaluates eligibility rules accurately', () => {
      const mockProfile = {
        headline: 'Senior Engineer',
        skills: ['React', 'Node'],
      }
      const mockResume = { id: 'res-1', title: 'Primary Resume' }
      const mockJob = { id: 'job-1', status: 'open', remote_type: 'remote' }

      // 1. Eligible when all criteria match
      const eligibleResult = autoApplyService.evaluateAutoApplyEligibility({
        profile: mockProfile,
        autoApplySettings: { enabled: true, minimum_match_percentage: 80, allowed_work_modes: ['remote'], require_resume: true, require_complete_profile: true },
        job: mockJob,
        matchScore: 85,
        primaryResume: mockResume,
        alreadyApplied: false,
      })
      assert.equal(eligibleResult.eligible, true)
      assert.equal(eligibleResult.reasons.length, 0)

      // 2. Ineligible when score below threshold
      const lowScoreResult = autoApplyService.evaluateAutoApplyEligibility({
        profile: mockProfile,
        autoApplySettings: { enabled: true, minimum_match_percentage: 90, allowed_work_modes: ['remote'], require_resume: true, require_complete_profile: true },
        job: mockJob,
        matchScore: 75,
        primaryResume: mockResume,
      })
      assert.equal(lowScoreResult.eligible, false)
      assert.ok(lowScoreResult.reasons.some((r) => r.includes('below candidate threshold')))

      // 3. Ineligible when work mode disallowed
      const modeMismatchResult = autoApplyService.evaluateAutoApplyEligibility({
        profile: mockProfile,
        autoApplySettings: { enabled: true, minimum_match_percentage: 70, allowed_work_modes: ['onsite'], require_resume: true, require_complete_profile: true },
        job: mockJob, // remote
        matchScore: 80,
        primaryResume: mockResume,
      })
      assert.equal(modeMismatchResult.eligible, false)
      assert.ok(modeMismatchResult.reasons.some((r) => r.includes('allowed modes')))
    })

    // Question Classification & Answering Contract Tests
    await t.test('question answering contract classifies questions correctly', () => {
      // Structured
      const salaryClass = classifyQuestion('What is your expected salary?')
      assert.equal(salaryClass.category, QuestionCategory.STRUCTURED)
      assert.equal(salaryClass.mappedField, 'expected_salary')

      const expClass = classifyQuestion('How many years of experience do you have in React?')
      assert.equal(expClass.category, QuestionCategory.STRUCTURED)
      assert.equal(expClass.mappedField, 'years_of_experience')

      const noticeClass = classifyQuestion('What is your notice period?')
      assert.equal(noticeClass.category, QuestionCategory.STRUCTURED)
      assert.equal(noticeClass.mappedField, 'notice_period')

      // Confirmation required
      const bgClass = classifyQuestion('Will you consent to a mandatory background check and drug screen?')
      assert.equal(bgClass.category, QuestionCategory.USER_CONFIRMATION_REQUIRED)

      // Generative
      const whyClass = classifyQuestion('Why do you want to join our engineering team?')
      assert.equal(whyClass.category, QuestionCategory.GENERATIVE)
    })

    await t.test('extractStructuredAnswer retrieves formatted answers from profile', () => {
      const profile = {
        expected_salary: 125000,
        salary_currency: 'USD',
        salary_period: 'yearly',
        joining_status: 'serving_notice',
        notice_period_days: 15,
        years_of_experience: 5.5,
        willing_to_relocate: true,
        work_authorization: 'Authorized US Worker',
      }

      assert.equal(extractStructuredAnswer('expected_salary', profile), 'USD 125,000 per yearly')
      assert.equal(extractStructuredAnswer('notice_period', profile), '15 days')
      assert.equal(extractStructuredAnswer('years_of_experience', profile), '5.5 years')
      assert.equal(extractStructuredAnswer('willing_to_relocate', profile), 'Yes')
      assert.equal(extractStructuredAnswer('work_authorization', profile), 'Authorized US Worker')
    })

    await t.test('AI service fallback cleanly reports disabled state without crashing', async () => {
      assert.equal(aiService.isAvailable(), false)
      const res = await aiService.generateAnswer({
        question: 'Why do you want to work here?',
        profile: { headline: 'Dev' },
      })
      assert.equal(res.available, false)
      assert.equal(res.status, 'disabled')
    })

    await t.test('RAGContextAssembler packages authoritative data without duplicating storage', () => {
      const assembler = new RAGContextAssembler()
      const context = assembler.assembleCandidateContext({
        profile: { headline: 'Senior Dev', skills: ['TypeScript', 'GraphQL'], expected_salary: 130000, salary_currency: 'USD' },
        resume: { title: 'Primary Resume', source_filename: 'cv.pdf', storage_key: 'abc.pdf' },
        job: { id: 'j-1', title: 'Tech Lead', company: 'Acme Inc', remote_type: 'remote' },
      })

      assert.equal(context.profile.headline, 'Senior Dev')
      assert.deepEqual(context.profile.skills, ['TypeScript', 'GraphQL'])
      assert.equal(context.resume.title, 'Primary Resume')
      assert.equal(context.job.title, 'Tech Lead')
      assert.ok(context.assembledAt)
    })
  })
}
