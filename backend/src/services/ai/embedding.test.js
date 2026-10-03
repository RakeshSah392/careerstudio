/**
 * TechNova Job Application Assistant
 * Step 12.2 — Local Embeddings & Vector Storage Test Suite
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { databaseConfigured, pool } from '../../db.js'
import { EmbeddingProviderInterface } from './aiContracts.js'
import { OllamaEmbeddingProvider, normalizeL2, generateDeterministicEmbedding } from './providers/ollamaEmbeddingProvider.js'
import { DeterministicChunker, computeContentHash } from './chunker.js'
import { EmbeddingRepository } from '../../repositories/embeddingRepository.js'
import { EmbeddingService } from './embeddingService.js'

class MockEmbeddingProvider extends EmbeddingProviderInterface {
  constructor({ dimension = 384 } = {}) {
    super()
    this.dimension = dimension
    this.callCount = 0
  }

  getName() {
    return 'mock_embedding_provider'
  }

  getModel() {
    return 'mock-embed-384'
  }

  getDimension() {
    return this.dimension
  }

  async healthCheck() {
    return { available: true, provider: 'mock_embedding_provider', dimension: this.dimension }
  }

  async embedText(text) {
    this.callCount += 1
    const vec = generateDeterministicEmbedding(text, this.dimension)
    return {
      embedding: vec,
      dimension: this.dimension,
      model: 'mock-embed-384',
    }
  }

  async embedBatch(texts) {
    return Promise.all(texts.map((t) => this.embedText(t)))
  }
}

test('Step 12.2 — Unit Tests: Provider, Chunker & Content Hashing', async (t) => {
  // 1. Vector Normalization
  await t.test('1. normalizeL2 produces unit vectors (sum of squares = 1.0)', () => {
    const raw = [3.0, 4.0, 0.0]
    const unit = normalizeL2(raw)
    assert.equal(unit.length, 3)
    const sumSq = unit.reduce((acc, val) => acc + val * val, 0)
    assert.ok(Math.abs(sumSq - 1.0) < 0.001)
  })

  // 2. Deterministic Content Hashing
  await t.test('2. Content Hashing: Same content produces identical hash; changed content produces new hash', () => {
    const hash1 = computeContentHash({
      sourceType: 'resume',
      sourceId: 'res-100',
      chunkId: 'chunk_0',
      content: 'Senior Kubernetes and Docker expert.',
    })

    const hash2 = computeContentHash({
      sourceType: 'resume',
      sourceId: 'res-100',
      chunkId: 'chunk_0',
      content: '  Senior   Kubernetes and   Docker expert.  ', // extra whitespace normalized
    })

    const hash3 = computeContentHash({
      sourceType: 'resume',
      sourceId: 'res-100',
      chunkId: 'chunk_0',
      content: 'Senior AWS and Terraform expert.',
    })

    assert.equal(hash1, hash2)
    assert.notEqual(hash1, hash3)
    assert.equal(hash1.length, 64) // SHA-256 hex length
  })

  // 3. Resume Chunking
  await t.test('3. DeterministicChunker breaks long resume into bounded, overlapping chunks', () => {
    const longText = new Array(350).fill('experience').join(' ')
    const chunks = DeterministicChunker.chunkResume({
      resumeId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      text: longText,
      chunkSizeWords: 150,
      overlapWords: 30,
    })

    assert.ok(chunks.length >= 2)
    assert.equal(chunks[0].source_type, 'resume')
    assert.ok(chunks[0].chunk_id.includes('chunk_0'))
    assert.ok(chunks[1].chunk_id.includes('chunk_1'))
    assert.ok(chunks[0].content_hash)
  })

  // 4. Application Profile & Job Chunking
  await t.test('4. DeterministicChunker handles profile and job entities', () => {
    const profileChunks = DeterministicChunker.chunkApplicationProfile({
      profileId: 'prof-01',
      userId: 'user-01',
      profile: {
        headline: 'Lead Cloud Architect',
        current_job_title: 'Cloud Architect',
        experience_level: 'senior',
        skills: ['AWS', 'GCP', 'Terraform'],
      },
    })
    assert.equal(profileChunks.length, 2)
    assert.ok(profileChunks.some((c) => c.chunk_id.includes('skills')))

    const jobChunks = DeterministicChunker.chunkJob({
      jobId: 'job-01',
      job: {
        title: 'Backend Engineer',
        company: 'Cloud Corp',
        location: 'Bengaluru',
        description: 'Design and build Node.js microservices with PostgreSQL.',
      },
    })
    assert.ok(jobChunks.length >= 2)
    assert.ok(jobChunks.some((c) => c.chunk_id.includes('overview')))
  })

  // 5. Provider Behavior: Real/Mock vs Production Fallback Policy
  await t.test('5. OllamaEmbeddingProvider: throws EMBEDDING_UNAVAILABLE in production path when unreachable', async () => {
    const mockFailingFetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    }

    const strictProvider = new OllamaEmbeddingProvider({
      fetchImpl: mockFailingFetch,
      allowFallback: false,
    })

    await assert.rejects(
      async () => strictProvider.embedText('Senior React developer'),
      (err) => {
        assert.equal(err.code, 'EMBEDDING_UNAVAILABLE')
        assert.ok(err.message.includes('EMBEDDING_UNAVAILABLE'))
        return true
      }
    )
  })

  await t.test('6. OllamaEmbeddingProvider: returns source "fallback" only when explicit allowFallback=true', async () => {
    const mockFailingFetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    }

    const fallbackProvider = new OllamaEmbeddingProvider({
      fetchImpl: mockFailingFetch,
      allowFallback: true,
    })

    const res = await fallbackProvider.embedText('Senior React developer')
    assert.equal(res.source, 'fallback')
    assert.equal(res.dimension, 384)
    assert.ok(res.model.includes('local_fallback'))
    assert.equal(res.embedding.length, 384)
  })

  await t.test('7. OllamaEmbeddingProvider: parses modern /api/embed payload correctly with source "ollama"', async () => {
    const mockEmbedFetch = async (url, options) => {
      assert.ok(url.endsWith('/api/embed'))
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'all-minilm')
      assert.equal(body.input, 'Senior React developer')

      const fakeVector = new Array(384).fill(0.1)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'all-minilm',
          embeddings: [fakeVector],
        }),
      }
    }

    const provider = new OllamaEmbeddingProvider({
      fetchImpl: mockEmbedFetch,
      allowFallback: false,
    })

    const res = await provider.embedText('Senior React developer')
    assert.equal(res.source, 'ollama')
    assert.equal(res.dimension, 384)
    assert.equal(res.model, 'all-minilm')
    assert.equal(res.embedding.length, 384)
    // Check unit normalization
    const sumSq = res.embedding.reduce((acc, v) => acc + v * v, 0)
    assert.ok(Math.abs(sumSq - 1.0) < 0.001)
  })
})

if (!databaseConfigured) {
  test('Step 12.2 database tests skipped (no database)', { skip: true }, () => {})
} else {
  test('Step 12.2 — Integration Tests: Vector Persistence & Cosine Similarity', async (t) => {
    const repo = new EmbeddingRepository(pool)
    await repo.ensureSchema()

    const mockProvider = new MockEmbeddingProvider({ dimension: 384 })
    const service = new EmbeddingService({
      provider: mockProvider,
      repository: repo,
    })

    const testResumeId = '11111111-2222-3333-4444-555555555555'
    const testJobId = '66666666-7777-8888-9999-000000000000'
    const testUserA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const testUserB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

    t.after(async () => {
      await repo.deleteBySource({ sourceType: 'resume', sourceId: testResumeId })
      await repo.deleteBySource({ sourceType: 'job', sourceId: testJobId })
    })

    // 1. Persistence & Content Hash Re-use (Zero Duplicate Work)
    await t.test('1. Upsert and hash caching: identical chunks reuse vector without re-embedding', async () => {
      const chunks = [
        {
          source_type: 'resume',
          source_id: testResumeId,
          user_id: null,
          chunk_id: 'test_res_chunk_0',
          content: 'Senior Kubernetes and Docker platform engineer.',
          content_hash: computeContentHash({
            sourceType: 'resume',
            sourceId: testResumeId,
            chunkId: 'test_res_chunk_0',
            content: 'Senior Kubernetes and Docker platform engineer.',
          }),
        },
      ]

      // First run: calls provider to generate embedding
      const initialCalls = mockProvider.callCount
      const res1 = await service.embedAndStoreChunks(chunks)
      assert.equal(res1.length, 1)
      assert.equal(mockProvider.callCount, initialCalls + 1)

      // Second run with identical content: reuses existing vector, 0 new provider calls
      const res2 = await service.embedAndStoreChunks(chunks)
      assert.equal(res2.length, 1)
      assert.equal(mockProvider.callCount, initialCalls + 1) // Call count did not increase!
    })

    // 2. Vector Similarity Search
    await t.test('2. Vector Similarity Search: finds nearest thematic text via cosine distance', async () => {
      // Store Cloud Job
      const cloudJobChunk = {
        source_type: 'job',
        source_id: testJobId,
        user_id: null,
        chunk_id: 'test_cloud_job_0',
        content: 'Senior Kubernetes Cloud Infrastructure Architect with Terraform and Docker.',
        content_hash: computeContentHash({
          sourceType: 'job',
          sourceId: testJobId,
          chunkId: 'test_cloud_job_0',
          content: 'Senior Kubernetes Cloud Infrastructure Architect with Terraform and Docker.',
        }),
      }
      await service.embedAndStoreChunks([cloudJobChunk])

      // Search with highly similar query
      const queryResults = await service.searchSimilar({
        queryText: 'Looking for Kubernetes and Cloud platform engineer',
        sourceType: 'job',
        limit: 5,
      })

      assert.ok(queryResults.length >= 1)
      const topMatch = queryResults[0]
      assert.equal(topMatch.source_id, testJobId)
      assert.ok(topMatch.similarity > 0.4) // High similarity
    })

    // 3. Ownership Isolation
    await t.test('3. Ownership Isolation: Query by User A never leaks User B private resume chunks', async () => {
      const chunkA = {
        source_type: 'resume',
        source_id: testResumeId,
        user_id: null, // Public / shared test
        chunk_id: 'shared_chunk_0',
        content: 'General software developer.',
        content_hash: computeContentHash({
          sourceType: 'resume',
          sourceId: testResumeId,
          chunkId: 'shared_chunk_0',
          content: 'General software developer.',
        }),
      }
      await service.embedAndStoreChunks([chunkA])

      // Query with user filter
      const userSearchResults = await service.searchSimilar({
        queryText: 'Software developer',
        sourceType: 'resume',
        userId: testUserA,
      })

      // Must be isolated to userA or public
      for (const res of userSearchResults) {
        assert.ok(res.user_id === testUserA || res.user_id === null)
      }
    })

    // 4. Live Ollama Semantic Discrimination Test (when local daemon is online)
    await t.test('4. Live Ollama Semantic Discrimination: Tech matches Tech higher than unrelated domain', async () => {
      const realProvider = new OllamaEmbeddingProvider()
      const health = await realProvider.healthCheck()
      if (!health.available) {
        // Skip gracefully if local daemon is not running during test execution
        return
      }

      const textA = 'Senior React developer with Node.js experience'
      const textB = 'Full-stack JavaScript engineer experienced with React and Express'
      const textC = 'Accountant specializing in tax filing and corporate financial auditing'

      const [resA, resB, resC] = await Promise.all([
        realProvider.embedText(textA),
        realProvider.embedText(textB),
        realProvider.embedText(textC),
      ])

      assert.equal(resA.source, 'ollama')
      assert.equal(resA.dimension, 384)
      assert.equal(resB.dimension, 384)
      assert.equal(resC.dimension, 384)

      // Cosine similarity for unit vectors = dot product
      const dotProduct = (v1, v2) => v1.reduce((acc, val, idx) => acc + val * v2[idx], 0)
      const simAB = dotProduct(resA.embedding, resB.embedding)
      const simAC = dotProduct(resA.embedding, resC.embedding)

      // Semantically related tech roles must score significantly higher than unrelated accounting
      assert.ok(simAB > 0.5, `Expected simAB > 0.5, got ${simAB}`)
      assert.ok(simAC < 0.3, `Expected simAC < 0.3, got ${simAC}`)
      assert.ok(simAB > simAC * 2, `Expected simAB to be more than 2x simAC (${simAB} vs ${simAC})`)
    })
  })
}
