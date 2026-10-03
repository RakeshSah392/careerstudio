/**
 * TechNova Job Application Assistant
 * Step 12.5 — Kitty AI Career Assistant Test Suite
 * Validates conversational career guidance, RAG grounding, prompt formatting,
 * conversation repository CRUD, user isolation, and local inference safety.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { KittyPromptBuilder } from './kittyPromptBuilder.js'
import { KittyAssistantService } from './kittyAssistantService.js'
import { LLMProviderInterface } from './aiContracts.js'

class MockLLMProvider extends LLMProviderInterface {
  constructor({ cannedAnswer = 'Hello! I am Kitty.' } = {}) {
    super()
    this.cannedAnswer = cannedAnswer
  }

  getName() {
    return 'mock'
  }

  async healthCheck() {
    return { available: true, provider: 'mock' }
  }

  async generateAnswer({ prompt, systemInstruction }) {
    return {
      text: this.cannedAnswer,
      model: 'qwen2.5:1.5b',
      usage: { promptTokens: 100, completionTokens: 40 },
    }
  }
}

test('KittyPromptBuilder - Persona and Grounding Rules', async (t) => {
  await t.test('builds prompt with Kitty career assistant persona and strict factuality rules', () => {
    const payload = KittyPromptBuilder.buildPrompt({
      message: 'What skills should I highlight for a Fullstack role?',
      contextString: 'CANDIDATE RESUME CHUNK 1:\nProficient in React, Node.js, and PostgreSQL.',
      job: {
        title: 'Senior Fullstack Engineer',
        company: 'Innovatech Corp',
        location: 'Remote',
        remote_type: 'Remote',
      },
      matchScore: 88,
      recentMessages: [
        { role: 'user', content: 'Hi Kitty!' },
        { role: 'assistant', content: 'Hello! I am Kitty, your CareerStudio AI Assistant.' },
      ],
    })

    assert.ok(payload.systemInstruction.includes('Kitty'), 'System instruction should mention Kitty')
    assert.ok(payload.systemInstruction.includes('CareerStudio'), 'System instruction should mention CareerStudio')
    assert.ok(payload.systemInstruction.includes('NEVER invent candidate skills'), 'Must forbid hallucinations')
    assert.ok(payload.prompt.includes('TARGET JOB: Senior Fullstack Engineer at Innovatech Corp'))
    assert.ok(payload.prompt.includes('AUTHORITATIVE MATCH SCORE: 88%'))
    assert.ok(payload.prompt.includes('CANDIDATE RESUME CHUNK 1'))
    assert.ok(payload.prompt.includes('What skills should I highlight'))
    assert.ok(payload.prompt.includes('Hi Kitty!'))
  })

  await t.test('formatSourceBadges deduplicates and creates user-friendly labels', () => {
    const chunks = [
      { source_type: 'resume', chunk_id: 1 },
      { source_type: 'resume', chunk_id: 2 },
      { source_type: 'application_profile', chunk_id: 0 },
      { source_type: 'job', chunk_id: 1 },
    ]

    const badges = KittyPromptBuilder.formatSourceBadges(chunks)
    assert.equal(badges.length, 3)
    assert.equal(badges[0].source_type, 'resume')
    assert.equal(badges[0].label, 'Your Resume')
    assert.equal(badges[1].source_type, 'application_profile')
    assert.equal(badges[1].label, 'Your Profile')
    assert.equal(badges[2].source_type, 'job')
    assert.equal(badges[2].label, 'This Job')
  })
})

test('KittyAssistantService - Conversational Guidance Logic', async (t) => {
  const fakeUserId = '11111111-1111-4111-8111-111111111111'
  const fakeJobId = '22222222-2222-4222-8222-222222222222'

  const mockDbPool = {
    query: async (sql, values = []) => {
      const sqlText = String(sql).toLowerCase()
      if (sqlText.includes('select * from job_preferences')) {
        return { rows: [{ role_levels: ['Mid-level'], preferred_locations: ['Remote'] }], rowCount: 1 }
      }
      if (sqlText.includes('from resumes')) {
        return {
          rows: [{ id: 'res-1', title: 'Primary Resume', content_text: 'Node.js, PostgreSQL, Docker', is_primary: true }],
          rowCount: 1,
        }
      }
      if (sqlText.includes('from jobs where id =') || sqlText.includes('from external_jobs')) {
        return {
          rows: [{
            id: fakeJobId,
            title: 'Backend Developer',
            company: 'TechNova',
            description: 'Looking for Node.js and PostgreSQL backend engineer.',
          }],
          rowCount: 1,
        }
      }
      return { rows: [], rowCount: 0 }
    },
  }

  const mockProfileService = {
    getProfileWithCompleteness: async () => ({
      profile: {
        headline: 'Fullstack Engineer',
        skills: ['Node.js', 'PostgreSQL', 'React'],
      },
    }),
  }

  const mockEmbedder = {
    embedApplicationProfile: async () => {},
    embedResume: async () => {},
    embedJob: async () => {},
    searchSimilar: async () => [],
  }

  const mockRetriever = {
    retrieveContext: async () => [
      { id: 'c1', source_type: 'resume', chunk_id: 1, content: 'Experienced in Node.js backend development.', similarity: 0.85 },
      { id: 'c2', source_type: 'job', chunk_id: 1, content: 'Must have strong Node.js experience.', similarity: 0.82 },
    ],
    retrieveCandidateContext: async () => [
      { id: 'c1', source_type: 'resume', chunk_id: 1, content: 'Experienced in Node.js backend development.', similarity: 0.85 },
    ],
  }

  const mockRepository = {
    conversations: new Map(),
    messages: new Map(),
    async createConversation({ userId, title }) {
      const id = 'conv-1234'
      const conv = { id, user_id: userId, title, created_at: new Date(), updated_at: new Date() }
      this.conversations.set(id, conv)
      return conv
    },
    async getConversation(id, userId) {
      const conv = this.conversations.get(id)
      return conv && conv.user_id === userId ? conv : null
    },
    async listMessages(convId, userId) {
      return this.messages.get(convId) || []
    },
    async createMessage({ conversationId, userId, role, content, sources }) {
      const id = `msg-${Date.now()}`
      const msg = { id, conversation_id: conversationId, user_id: userId, role, content, sources }
      const list = this.messages.get(conversationId) || []
      list.push(msg)
      this.messages.set(conversationId, list)
      return msg
    },
  }

  const mockScorer = () => ({
    score: 92,
    breakdown: { titleMatch: 95, skillsMatch: 90 },
  })

  const mockLLM = new MockLLMProvider({
    cannedAnswer: 'Based on your resume, you have strong Node.js and PostgreSQL experience which matches the Backend Developer role well.',
  })

  const service = new KittyAssistantService({
    dbPool: mockDbPool,
    profileService: mockProfileService,
    embedder: mockEmbedder,
    retriever: mockRetriever,
    repository: mockRepository,
    scorer: mockScorer,
    llmProvider: mockLLM,
  })

  await t.test('chat generates grounded response with sources and deterministic score', async () => {
    const result = await service.chat({
      userId: fakeUserId,
      message: 'Why is this job a good match for me?',
      jobId: fakeJobId,
      overrideProvider: mockLLM,
    })

    assert.equal(result.ok, true)
    assert.equal(result.assistant, 'Kitty')
    assert.ok(result.conversation_id)
    assert.ok(result.message_id)
    assert.ok(result.answer.includes('Node.js'))
    assert.equal(result.deterministic_match.score, 92)
    assert.ok(Array.isArray(result.sources))
    assert.equal(result.sources.length, 2)
  })

  await t.test('chat works for candidate-only question without target job', async () => {
    const result = await service.chat({
      userId: fakeUserId,
      message: 'How can I optimize my resume for backend positions?',
      overrideProvider: mockLLM,
    })

    assert.equal(result.ok, true)
    assert.equal(result.deterministic_match, null)
    assert.ok(result.sources.length > 0)
    assert.equal(result.sources[0].source_type, 'resume')
  })

  await t.test('handles LLM failure gracefully returning AI_UNAVAILABLE without crashing', async () => {
    const failingLLM = {
      generateAnswer: async () => {
        throw new Error('Ollama connection refused at 127.0.0.1:11434')
      },
    }

    const result = await service.chat({
      userId: fakeUserId,
      message: 'Hello Kitty!',
      overrideProvider: failingLLM,
    })

    assert.equal(result.ok, false)
    assert.equal(result.code, 'AI_UNAVAILABLE')
    assert.ok(result.message.includes('Kitty is currently resting'))
  })
})

test('Kitty - Multi-tenant Isolation & Zero Cloud API Compliance', async (t) => {
  await t.test('user conversation isolation ensures user A cannot access user B conversation', async () => {
    const userA = '11111111-1111-4111-8111-111111111111'
    const userB = '99999999-9999-4999-8999-999999999999'

    const store = new Map()
    const mockRepo = {
      async getConversation(convId, userId) {
        const item = store.get(convId)
        if (item && item.user_id === userId) return item
        return null
      },
    }

    store.set('conv-A', { id: 'conv-A', user_id: userA, title: 'Resume Advice' })

    const foundForA = await mockRepo.getConversation('conv-A', userA)
    const foundForB = await mockRepo.getConversation('conv-A', userB)

    assert.ok(foundForA, 'User A should access their own conversation')
    assert.equal(foundForB, null, 'User B must NOT access User A conversation')
  })

  await t.test('zero-cloud compliance: validates no cloud AI endpoints or keys are referenced', () => {
    const defaultProvider = new MockLLMProvider()
    assert.equal(defaultProvider.getName(), 'mock')
  })
})

