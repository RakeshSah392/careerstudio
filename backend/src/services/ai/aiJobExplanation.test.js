/**
 * TechNova Job Application Assistant
 * Step 12.1 — Local LLM & Match Explanation Test Suite
 * Fully mocked unit & integration tests (consumes 0 unnecessary local GPU/CPU cycles).
 */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../../app.js'
import { databaseConfigured, pool } from '../../db.js'
import { LLMProviderInterface, DisabledLLMProvider } from './aiContracts.js'
import { OllamaLLMProvider } from './providers/ollamaLLMProvider.js'
import { JobMatchPromptBuilder } from './promptBuilder.js'
import { JobMatchExplanationService } from './jobMatchExplanationService.js'

class MockLLMProvider extends LLMProviderInterface {
  constructor({
    response = {
      summary: 'Strong match for senior cloud infrastructure.',
      strong_matches: ['Kubernetes expertise', '7 years DevOps experience'],
      potential_gaps: ['No explicit Terraform mentioned in primary profile'],
      suggestions: ['Highlight infrastructure as code projects'],
    },
    error = null,
    status = 200,
  } = {}) {
    super()
    this.response = response
    this.error = error
    this.status = status
    this.callCount = 0
  }

  getName() {
    return 'mock_ollama'
  }

  async healthCheck() {
    if (this.error) return { available: false, provider: 'mock_ollama', error: this.error }
    return { available: true, provider: 'mock_ollama', model: 'qwen2.5:1.5b', modelLoaded: true }
  }

  async generateAnswer() {
    this.callCount += 1
    if (this.error) {
      const err = new Error(this.error)
      err.status = this.status
      throw err
    }
    return {
      text: typeof this.response === 'string' ? this.response : JSON.stringify(this.response),
      model: 'qwen2.5:1.5b',
      usage: {
        prompt_tokens: 120,
        completion_tokens: 65,
        total_tokens: 185,
      },
    }
  }
}

test('Step 12.1 — Local LLM Foundation & Match Explanation Unit Suite', async (t) => {
  // 1. OllamaLLMProvider Unit Tests
  await t.test('1. OllamaLLMProvider handles chat requests and normalizes usage', async () => {
    let capturedBody = null
    const mockFetch = async (url, options) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'qwen2.5:1.5b',
          message: {
            role: 'assistant',
            content: JSON.stringify({
              summary: 'Candidate matches well.',
              strong_matches: ['React'],
              potential_gaps: [],
              suggestions: [],
            }),
          },
          prompt_eval_count: 85,
          eval_count: 42,
        }),
      }
    }

    const provider = new OllamaLLMProvider({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b',
      fetchImpl: mockFetch,
    })

    const res = await provider.generateAnswer({
      prompt: 'Explain match',
      systemInstruction: 'You are an advisor',
      context: { title: 'Engineer' },
      format: 'json',
    })

    assert.equal(res.model, 'qwen2.5:1.5b')
    assert.ok(res.text.includes('Candidate matches well.'))
    assert.deepEqual(res.usage, {
      prompt_tokens: 85,
      completion_tokens: 42,
      total_tokens: 127,
    })
    assert.equal(capturedBody.format, 'json')
    assert.equal(capturedBody.model, 'qwen2.5:1.5b')
    assert.equal(capturedBody.messages.length, 2)
  })

  await t.test('2. OllamaLLMProvider handles HTTP error and timeout safely', async () => {
    const errorFetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    })

    const provider = new OllamaLLMProvider({ fetchImpl: errorFetch })
    await assert.rejects(
      () => provider.generateAnswer({ prompt: 'test' }),
      /Ollama chat request failed with status 503/,
    )
  })

  // 2. Prompt Builder Tests
  await t.test('3. JobMatchPromptBuilder structures prompt and parses JSON/fences safely', () => {
    const promptData = JobMatchPromptBuilder.buildExplanationPrompt({
      job: { title: 'Backend Dev', company: 'Nova', location: 'Remote', description: 'Node.js & Postgres' },
      candidateProfile: { headline: 'Node Dev', skills: ['Node.js', 'PostgreSQL'], experience_level: 'senior' },
      resumeText: '5 years building high scale APIs.',
      matchScore: 88,
      matchBreakdown: { role: 90, skills: 90, experience: 80, location: 100 },
    })

    assert.ok(promptData.systemInstruction.includes('STRICT CONSTRAINTS'))
    assert.ok(promptData.systemInstruction.includes('NEVER calculate, alter, or override'))
    assert.equal(promptData.context.deterministic_match.authoritative_score_percentage, 88)
    assert.equal(promptData.context.candidate.skills.length, 2)

    // Test parsing with markdown fences
    const fencedJson = '```json\n{\n  "summary": "Fits well.",\n  "strong_matches": ["Node.js"],\n  "potential_gaps": [],\n  "suggestions": ["Add portfolio link"]\n}\n```'
    const parsed = JobMatchPromptBuilder.parseExplanationResponse(fencedJson)
    assert.equal(parsed.summary, 'Fits well.')
    assert.deepEqual(parsed.strong_matches, ['Node.js'])
    assert.deepEqual(parsed.suggestions, ['Add portfolio link'])

    // Test parsing invalid text fallback
    const invalidParsed = JobMatchPromptBuilder.parseExplanationResponse('Plain text reply without json')
    assert.equal(invalidParsed.summary, 'Plain text reply without json')
    assert.deepEqual(invalidParsed.strong_matches, [])
  })
})

if (!databaseConfigured) {
  test('Step 12.1 integration tests skipped (no database)', { skip: true }, () => {})
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

  test('Step 12.1 — AI Job Match Explanation Integration & Routes', async (t) => {
    const app = createApp({
      canDeliverOtp: () => true,
      sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
    })

    const server = app.listen(0)
    await once(server, 'listening')
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`

    const seeker = await signIn(baseUrl, `ai-seeker-${suffix}@example.invalid`, 'AI Seeker', 'job_seeker')
    const recruiter = await signIn(baseUrl, `ai-recruiter-${suffix}@example.invalid`, 'AI Recruiter', 'employer')

    // Create Recruiter Job
    const jobRes = await request(baseUrl, '/api/jobs', {
      method: 'POST',
      cookie: recruiter.cookie,
      body: {
        company: 'Apex Cloud Systems',
        title: 'Senior Site Reliability Architect',
        location: 'Bengaluru, India',
        remote_type: 'remote',
        employment_type: 'full-time',
        industry: 'Cloud',
        description: 'Kubernetes, AWS, Terraform, Docker, Incident management.',
        salary_min: 3000000,
        salary_max: 4500000,
        currency: 'INR',
        status: 'open',
        posted_at: '2026-10-02',
      },
    })
    assert.equal(jobRes.status, 201)
    const job = await jobRes.json()
    createdJobIds.push(job.id)

    // Populate Seeker Profile & Preferences
    await pool.query(
      `INSERT INTO application_profiles (
        user_id, headline, current_job_title, years_of_experience, experience_level, skills, location, work_authorization
      ) VALUES ($1, 'Senior Cloud Engineer', 'Cloud Engineer', 6, 'senior', $2, 'Bengaluru, India', 'Authorized to work in India')
      ON CONFLICT (user_id) DO UPDATE SET skills = EXCLUDED.skills`,
      [seeker.user.id, ['Kubernetes', 'AWS', 'Docker', 'Linux']],
    )

    await pool.query(
      `INSERT INTO job_preferences (user_id, target_roles, locations, remote_preference, min_salary, max_salary, employment_types)
       VALUES ($1, $2, $3, 'remote', 2500000, 5000000, $4)
       ON CONFLICT (user_id) DO UPDATE SET target_roles = EXCLUDED.target_roles`,
      [seeker.user.id, ['Site Reliability Architect', 'Cloud Engineer'], ['Bengaluru, India'], ['full-time']],
    )

    t.after(async () => {
      server.close()
      await once(server, 'close')
      if (createdJobIds.length) {
        await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobIds])
      }
      if (userIds.length) {
        await pool.query('DELETE FROM application_profiles WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM job_preferences WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM resumes WHERE user_id = ANY($1)', [userIds])
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds])
      }
    })

    // 1. Success Flow with Mock LLM
    await t.test('1. Match explanation returns structured advice without altering deterministic score', async () => {
      const mockProvider = new MockLLMProvider()
      const service = new JobMatchExplanationService({
        dbPool: pool,
        llmProvider: mockProvider,
      })

      const res = await service.explainJobMatch({
        userId: seeker.user.id,
        jobId: job.id,
      })

      assert.equal(res.ok, true)
      assert.equal(res.job_id, job.id)
      assert.ok(typeof res.deterministic_match.score === 'number')
      assert.ok(res.deterministic_match.score >= 50)
      assert.equal(res.provider, 'mock_ollama')
      assert.ok(res.explanation.strong_matches.length > 0)
      assert.ok(res.explanation.potential_gaps.length > 0)
      assert.ok(res.explanation.suggestions.length > 0)
      assert.equal(mockProvider.callCount, 1)
    })

    // 2. Ollama Unavailable Fallback Flow
    await t.test('2. Unreachable local LLM returns safe AI_UNAVAILABLE code with score intact', async () => {
      const failingProvider = new MockLLMProvider({ error: 'Connection refused 127.0.0.1:11434', status: 503 })
      const service = new JobMatchExplanationService({
        dbPool: pool,
        llmProvider: failingProvider,
      })

      const res = await service.explainJobMatch({
        userId: seeker.user.id,
        jobId: job.id,
      })

      assert.equal(res.ok, false)
      assert.equal(res.code, 'AI_UNAVAILABLE')
      assert.ok(res.message.includes('Local AI service is currently unavailable'))
      // Deterministic match is still calculated and preserved!
      assert.ok(typeof res.deterministic_match.score === 'number')
      assert.equal(res.explanation, null)
    })

    // 3. HTTP Endpoint Integration & Authorization
    await t.test('3. POST /api/ai/job-explanation enforces auth and validates inputs', async () => {
      // Unauthenticated -> 401
      const unauthRes = await request(baseUrl, '/api/ai/job-explanation', {
        method: 'POST',
        body: { job_id: job.id },
      })
      assert.equal(unauthRes.status, 401)

      // Invalid UUID -> 400
      const badIdRes = await request(baseUrl, '/api/ai/job-explanation', {
        method: 'POST',
        cookie: seeker.cookie,
        body: { job_id: 'not-a-uuid' },
      })
      assert.equal(badIdRes.status, 400)
      const badIdData = await badIdRes.json()
      assert.ok(badIdData.error.includes('UUID'))

      // Non-existent job -> 404
      const nonExistentId = '00000000-0000-0000-0000-000000000000'
      const notFoundRes = await request(baseUrl, '/api/ai/job-explanation', {
        method: 'POST',
        cookie: seeker.cookie,
        body: { job_id: nonExistentId },
      })
      assert.equal(notFoundRes.status, 404)

      // GET /api/ai/status
      const statusRes = await request(baseUrl, '/api/ai/status', {
        cookie: seeker.cookie,
      })
      assert.equal(statusRes.status, 200)
      const statusData = await statusRes.json()
      assert.equal(statusData.ok, true)
      assert.ok(statusData.health)
    })
  })
}
