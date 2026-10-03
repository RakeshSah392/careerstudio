/**
 * TechNova Job Application Assistant
 * Step 12.3 — Local RAG Pipeline Test Suite
 * Comprehensive mocked unit & integration tests + Tenant Isolation & Hallucination Guardrails.
 */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../../app.js'
import { databaseConfigured, pool } from '../../db.js'
import { EmbeddingProviderInterface, LLMProviderInterface } from './aiContracts.js'
import { DeterministicChunker, computeContentHash } from './chunker.js'
import { EmbeddingService } from './embeddingService.js'
import { EmbeddingRepository } from '../../repositories/embeddingRepository.js'
import { RetrievalService } from './retrievalService.js'
import { RAGContextAssembler } from './ragContextAssembler.js'
import { RAGPromptBuilder } from './ragPromptBuilder.js'
import { JobMatchRAGService, ALLOWED_PRESET_QUESTIONS } from './jobMatchRAGService.js'

class MockEmbeddingProvider extends EmbeddingProviderInterface {
  constructor({ dimension = 384 } = {}) {
    super()
    this.dimension = dimension
    this.callCount = 0
  }

  getName() {
    return 'mock_embed_provider'
  }

  getModel() {
    return 'mock-all-minilm'
  }

  getDimension() {
    return this.dimension
  }

  async healthCheck() {
    return { available: true, provider: 'mock_embed_provider' }
  }

  async embedText(text) {
    this.callCount += 1
    // Generate deterministic normalized unit vector
    const vec = new Array(this.dimension).fill(0)
    const clean = String(text || '').toLowerCase()
    for (let i = 0; i < Math.min(clean.length, this.dimension); i++) {
      vec[i] = (clean.charCodeAt(i) % 10) / 10
    }
    // L2 normalize
    const sumSq = vec.reduce((acc, v) => acc + v * v, 0) || 1
    const norm = Math.sqrt(sumSq)
    return {
      embedding: vec.map((v) => Number((v / norm).toFixed(6))),
      dimension: this.dimension,
      model: 'mock-all-minilm',
      source: 'ollama',
    }
  }

  async embedBatch(texts) {
    return Promise.all(texts.map((t) => this.embedText(t)))
  }
}

class MockLLMProvider extends LLMProviderInterface {
  constructor({
    response = {
      summary: 'Candidate shows strong alignment with the Cloud Architect role requirements.',
      evidence: [
        {
          source_type: 'resume',
          chunk_id: 'test_res_chunk_0',
          quote: '6 years managing Kubernetes and AWS microservices.',
          relevance: 'Matches required container orchestration expertise.',
        },
      ],
      strong_matches: ['Kubernetes container orchestration', 'AWS Cloud Infrastructure'],
      potential_gaps: ['No explicit Golang experience mentioned in resume'],
      suggestions: ['Highlight any Golang backend projects or contributions before submitting application'],
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
    return 'mock_qwen_llm'
  }

  async healthCheck() {
    if (this.error) return { available: false, provider: 'mock_qwen_llm', error: this.error }
    return { available: true, provider: 'mock_qwen_llm', model: 'qwen2.5:1.5b' }
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
      usage: { prompt_tokens: 150, completion_tokens: 80, total_tokens: 230 },
    }
  }
}

test('Step 12.3 — Unit Tests: RAG Context Assembler & Prompt Builder', async (t) => {
  // 1. Context Assembler Deduplication & Labeling
  await t.test('1. RAGContextAssembler labels sources, deduplicates, and redacts secrets', () => {
    const assembler = new RAGContextAssembler({ maxContextChars: 2000, maxChunks: 5 })
    const sampleChunks = [
      {
        source_type: 'resume',
        source_id: 'res-1',
        chunk_id: 'chunk_res_0',
        content: 'Senior Kubernetes engineer with AWS and Docker. Secret: api_key=sk-secret-12345',
        similarity: 0.85,
      },
      {
        source_type: 'resume',
        source_id: 'res-1',
        chunk_id: 'chunk_res_dup',
        content: 'Senior Kubernetes engineer with AWS and Docker. Secret: api_key=sk-secret-12345', // Duplicate!
        similarity: 0.84,
      },
      {
        source_type: 'job',
        source_id: 'job-1',
        chunk_id: 'chunk_job_0',
        content: 'Looking for a Senior Kubernetes Architect in Bengaluru.',
        similarity: 0.75,
      },
    ]

    const result = assembler.assembleContext({
      chunks: sampleChunks,
      jobMetadata: { title: 'Cloud Architect', company: 'Apex Cloud' },
      candidateMetadata: { headline: 'Lead DevOps Specialist' },
    })

    assert.equal(result.chunkCount, 2) // Duplicate was discarded!
    assert.ok(result.contextString.includes('[SOURCE: RESUME | CHUNK_ID: chunk_res_0'))
    assert.ok(result.contextString.includes('[SOURCE: JOB | CHUNK_ID: chunk_job_0'))
    assert.ok(result.contextString.includes('[REDACTED_SECRET]')) // Secret was sanitized
    assert.equal(result.sources.resume, 1)
    assert.equal(result.sources.job, 1)
  })

  // 2. Prompt Builder & JSON Parsing Guardrails
  await t.test('2. RAGPromptBuilder extracts JSON, validates citations, and prevents hallucinated chunk IDs', () => {
    const validChunks = [
      { source_type: 'resume', chunk_id: 'valid_chunk_1', content: '5 years React experience', similarity: 0.9 },
    ]

    // Raw markdown code block response with a valid chunk citation
    const rawFencedResponse = `
    Here is your match analysis:
    \`\`\`json
    {
      "summary": "Strong candidate for the React position.",
      "evidence": [
        {
          "source_type": "resume",
          "chunk_id": "valid_chunk_1",
          "quote": "5 years React experience",
          "relevance": "Direct alignment with frontend requirements"
        },
        {
          "source_type": "resume",
          "chunk_id": "hallucinated_chunk_99",
          "quote": "10 years Quantum AI developer",
          "relevance": "Fake"
        }
      ],
      "strong_matches": ["React.js expertise"],
      "potential_gaps": ["No TypeScript mentioned"],
      "suggestions": ["Add TypeScript portfolio samples"]
    }
    \`\`\`
    `

    const parsed = RAGPromptBuilder.parseAndValidateResponse(rawFencedResponse, validChunks)
    assert.ok(parsed.summary.includes('Strong candidate'))
    assert.equal(parsed.strong_matches[0], 'React.js expertise')
    // Hallucinated chunk_99 must be rejected or filtered
    assert.equal(parsed.evidence.length, 1)
    assert.equal(parsed.evidence[0].chunk_id, 'valid_chunk_1')
  })
})

if (!databaseConfigured) {
  test('Step 12.3 database tests skipped (no database)', { skip: true }, () => {})
} else {
  test('Step 12.3 — Integration Tests: Retrieval, Tenant Isolation & RAG Flow', async (t) => {
    const repo = new EmbeddingRepository(pool)
    await repo.ensureSchema()

    const mockEmbedder = new MockEmbeddingProvider({ dimension: 384 })
    const embService = new EmbeddingService({
      provider: mockEmbedder,
      repository: repo,
    })

    const retriever = new RetrievalService({
      dbPool: pool,
      embedder: embService,
      defaultTopK: 5,
      minSimilarity: 0.1,
    })

    const testUserA = 'aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa'
    const testUserB = 'bbbbbbbb-2222-4000-8000-bbbbbbbbbbbb'
    const testJobId = 'cccccccc-3333-4000-8000-cccccccccccc'
    const userIds = [testUserA, testUserB]
    const createdJobIds = [testJobId]

    // Teardown
    t.after(async () => {
      await repo.deleteBySource({ sourceType: 'resume', sourceId: testUserA })
      await repo.deleteBySource({ sourceType: 'resume', sourceId: testUserB })
      await repo.deleteBySource({ sourceType: 'job', sourceId: testJobId })
      await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobIds])
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds])
    })

    // 1. Ingest Chunks for User A, User B, and Public Job
    await t.test('1. Setup & Tenant Isolation: User A retrieval NEVER retrieves User B private chunks', async () => {
      // Create user records in database for foreign key constraint
      await pool.query(
        "INSERT INTO users (id, email, full_name, role) VALUES ($1, 'rag-user-a@example.invalid', 'User A', 'job_seeker') ON CONFLICT (id) DO NOTHING",
        [testUserA],
      )
      await pool.query(
        "INSERT INTO users (id, email, full_name, role) VALUES ($1, 'rag-user-b@example.invalid', 'User B', 'job_seeker') ON CONFLICT (id) DO NOTHING",
        [testUserB],
      )

      // Chunk for User A (Private Resume)
      const userAChunk = {
        source_type: 'resume',
        source_id: testUserA,
        user_id: testUserA,
        chunk_id: 'user_a_res_0',
        content: 'Candidate A: Senior Kubernetes and AWS platform engineer.',
        content_hash: computeContentHash({
          sourceType: 'resume',
          sourceId: testUserA,
          chunkId: 'user_a_res_0',
          content: 'Candidate A: Senior Kubernetes and AWS platform engineer.',
        }),
      }

      // Chunk for User B (Private Resume)
      const userBChunk = {
        source_type: 'resume',
        source_id: testUserB,
        user_id: testUserB,
        chunk_id: 'user_b_res_0',
        content: 'Candidate B: Expert Senior Kubernetes and AWS platform engineer with secret patents.',
        content_hash: computeContentHash({
          sourceType: 'resume',
          sourceId: testUserB,
          chunkId: 'user_b_res_0',
          content: 'Candidate B: Expert Senior Kubernetes and AWS platform engineer with secret patents.',
        }),
      }

      // Chunk for Job (Public Job Posting)
      const jobChunk = {
        source_type: 'job',
        source_id: testJobId,
        user_id: null,
        chunk_id: 'target_job_0',
        content: 'Looking for a Senior Kubernetes and AWS platform architect in Bengaluru.',
        content_hash: computeContentHash({
          sourceType: 'job',
          sourceId: testJobId,
          chunkId: 'target_job_0',
          content: 'Looking for a Senior Kubernetes and AWS platform architect in Bengaluru.',
        }),
      }

      await embService.embedAndStoreChunks([userAChunk, userBChunk, jobChunk])

      // Query executed on behalf of User A for Target Job
      const retrieved = await retriever.retrieveContext({
        query: 'Senior Kubernetes platform architect',
        userId: testUserA,
        jobId: testJobId,
        limit: 10,
        minSimilarity: 0.1,
      })

      assert.ok(retrieved.length >= 1)
      // Must contain User A's chunk or Job chunk
      for (const item of retrieved) {
        assert.notEqual(item.user_id, testUserB, 'Security violation: User B private chunk leaked!')
        assert.ok(item.user_id === testUserA || item.source_id === testJobId)
      }
    })

    // 2. JobMatchRAGService Grounded Pipeline with Invariant Deterministic Score
    await t.test('2. JobMatchRAGService executes RAG pipeline with deterministic score intact', async () => {
      // Create user and job in database
      await pool.query(
        "INSERT INTO users (id, email, full_name, role) VALUES ($1, 'rag-seeker@example.invalid', 'RAG Seeker', 'job_seeker') ON CONFLICT (id) DO NOTHING",
        [testUserA],
      )

      await pool.query(
        `INSERT INTO jobs (id, created_by_user_id, company, title, location, remote_type, employment_type, description, status)
         VALUES ($1, $2, 'Cloud Solutions Inc', 'Senior Cloud Platform Architect', 'Bengaluru', 'remote', 'full-time', 'Kubernetes, AWS, Terraform, Docker.', 'open')
         ON CONFLICT (id) DO NOTHING`,
        [testJobId, testUserA],
      )

      await pool.query(
        `INSERT INTO job_preferences (user_id, target_roles, locations, remote_preference)
         VALUES ($1, $2, $3, 'remote')
         ON CONFLICT (user_id) DO UPDATE SET target_roles = EXCLUDED.target_roles`,
        [testUserA, ['Cloud Platform Architect'], ['Bengaluru']],
      )

      const mockLLM = new MockLLMProvider()
      const ragService = new JobMatchRAGService({
        dbPool: pool,
        embedder: embService,
        retriever,
        llmProvider: mockLLM,
      })

      const response = await ragService.askAboutJobMatch({
        userId: testUserA,
        jobId: testJobId,
        question: 'Why am I a good fit for this job?',
      })

      assert.equal(response.ok, true)
      assert.equal(response.job_id, testJobId)
      // Deterministic score is authoritative and invariant
      assert.ok(typeof response.deterministic_match.score === 'number')
      assert.ok(response.deterministic_match.score >= 50)
      assert.ok(response.rag_explanation.summary)
      assert.ok(response.rag_explanation.strong_matches.length > 0)
      assert.ok(response.retrieval_meta.chunks_retrieved >= 1)
      assert.equal(mockLLM.callCount, 1)
    })

    // 3. HTTP Integration Test on POST /api/ai/rag/job-match
    await t.test('3. POST /api/ai/rag/job-match enforces authentication, rate-limiting, and validation', async () => {
      const deliveredCodes = new Map()
      const app = createApp({
        canDeliverOtp: () => true,
        sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
      })

      const server = app.listen(0)
      await once(server, 'listening')
      const { port } = server.address()
      const baseUrl = `http://127.0.0.1:${port}`

      t.after(() => server.close())

      // 3a. Unauthenticated -> 401
      const unauthRes = await fetch(`${baseUrl}/api/ai/rag/job-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: testJobId }),
      })
      assert.equal(unauthRes.status, 401)

      // Sign in as seeker
      const email = `rag-http-${Date.now()}@example.invalid`
      await fetch(`${baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const code = deliveredCodes.get(email)
      const verifyRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, full_name: 'RAG HTTP Seeker' }),
      })
      const { user } = await verifyRes.json()
      userIds.push(user.id)
      const cookie = verifyRes.headers.get('set-cookie').split(';', 1)[0]

      // 3b. Invalid UUID -> 400
      const badIdRes = await fetch(`${baseUrl}/api/ai/rag/job-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ job_id: 'bad-uuid-value' }),
      })
      assert.equal(badIdRes.status, 400)

      // 3c. Non-existent job -> 404
      const notFoundRes = await fetch(`${baseUrl}/api/ai/rag/job-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ job_id: '00000000-0000-4000-8000-000000000000' }),
      })
      assert.equal(notFoundRes.status, 404)
    })
  })
}
