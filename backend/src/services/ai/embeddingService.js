/**
 * TechNova Job Application Assistant
 * Step 12.2 — Embedding Service
 * Coordinates deterministic chunking, content-hash caching, vector generation, and persistence.
 */

import { DeterministicChunker, computeContentHash } from './chunker.js'
import { OllamaEmbeddingProvider } from './providers/ollamaEmbeddingProvider.js'
import { embeddingRepository } from '../../repositories/embeddingRepository.js'
import { logger } from '../../lib/logger.js'

export class EmbeddingService {
  constructor({
    provider = new OllamaEmbeddingProvider(),
    repository = embeddingRepository,
    chunker = DeterministicChunker,
  } = {}) {
    this.provider = provider
    this.repository = repository
    this.chunker = chunker
  }

  getProvider() {
    return this.provider
  }

  /**
   * Embeds a single text string with validation and normalization.
   *
   * @param {string} text
   * @returns {Promise<{ embedding: number[], dimension: number, model: string }>}
   */
  async embedText(text) {
    const cleanText = this.chunker.normalizeText(text)
    if (!cleanText) {
      throw new Error('Text to embed cannot be empty.')
    }
    return this.provider.embedText(cleanText)
  }

  /**
   * Ingests, hashes, embeds, and saves chunks for any source entity.
   * Efficiently reuses existing embeddings if chunk content hash is identical.
   *
   * @param {Array<object>} chunks - Output from DeterministicChunker
   * @returns {Promise<Array<object>>}
   */
  async embedAndStoreChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) return []

    // Ensure database table exists
    await this.repository.ensureSchema()

    const savedRecords = []

    for (const chunk of chunks) {
      const hash = chunk.content_hash || computeContentHash({
        sourceType: chunk.source_type,
        sourceId: chunk.source_id,
        chunkId: chunk.chunk_id,
        content: chunk.content,
      })

      // 1. Check if an embedding with this exact content hash already exists
      const existing = await this.repository.findByContentHash(hash)
      let vector = existing?.embedding || null
      let model = existing?.embedding_model || this.provider.getModel()
      let dimension = existing?.dimension || this.provider.getDimension()

      // 2. If not found, generate a new embedding
      if (!vector) {
        logger.info('Generating new embedding for chunk', {
          sourceType: chunk.source_type,
          sourceId: chunk.source_id,
          chunkId: chunk.chunk_id,
        })
        const generated = await this.provider.embedText(chunk.content)
        vector = generated.embedding
        model = generated.model
        dimension = generated.dimension
      } else {
        logger.info('Reusing existing embedding for identical content hash', {
          chunkId: chunk.chunk_id,
          contentHash: hash,
        })
      }

      // 3. Upsert into database
      const record = await this.repository.upsertEmbedding({
        userId: chunk.user_id || null,
        sourceType: chunk.source_type,
        sourceId: chunk.source_id,
        chunkId: chunk.chunk_id,
        content: chunk.content,
        contentHash: hash,
        embedding: vector,
        model,
        dimension,
        metadata: chunk.metadata || {},
      })

      savedRecords.push(record)
    }

    return savedRecords
  }

  /**
   * Chunks and embeds a candidate resume.
   */
  async embedResume({ resumeId, userId, text }) {
    const chunks = this.chunker.chunkResume({ resumeId, userId, text })
    return this.embedAndStoreChunks(chunks)
  }

  /**
   * Chunks and embeds an application profile.
   */
  async embedApplicationProfile({ profileId, userId, profile }) {
    const chunks = this.chunker.chunkApplicationProfile({ profileId, userId, profile })
    return this.embedAndStoreChunks(chunks)
  }

  /**
   * Chunks and embeds a job posting.
   */
  async embedJob({ jobId, job }) {
    const chunks = this.chunker.chunkJob({ jobId, job })
    return this.embedAndStoreChunks(chunks)
  }

  /**
   * Performs vector similarity search for a query text.
   *
   * @param {object} options
   * @param {string} options.queryText - Candidate or recruiter search text
   * @param {string} [options.sourceType] - 'resume' | 'job' | 'application_profile'
   * @param {string} [options.userId] - Restricts search to this user's private data
   * @param {number} [options.limit=5]
   * @param {number} [options.minSimilarity=0.0]
   * @returns {Promise<Array<object>>}
   */
  async searchSimilar({
    queryText,
    sourceType = null,
    userId = null,
    limit = 5,
    minSimilarity = 0.0,
  }) {
    const queryEmbed = await this.embedText(queryText)
    return this.repository.findSimilar({
      embedding: queryEmbed.embedding,
      sourceType,
      userId,
      limit,
      minSimilarity,
    })
  }
}

export const embeddingService = new EmbeddingService()
