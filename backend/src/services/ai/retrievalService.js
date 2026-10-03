/**
 * TechNova Job Application Assistant
 * Step 12.3 — Local Semantic Retrieval Service
 * Retrieves top-K thematic chunks from PostgreSQL vector storage with strict tenant security.
 */

import { pool } from '../../db.js'
import { isUuid } from '../../lib/validation.js'
import { logger } from '../../lib/logger.js'
import { RetrievalServiceInterface } from './aiContracts.js'
import { embeddingService } from './embeddingService.js'

export class RetrievalService extends RetrievalServiceInterface {
  constructor({
    dbPool = pool,
    embedder = embeddingService,
    defaultTopK = 5,
    maxTopK = 20,
    defaultMinSimilarity = 0.25,
  } = {}) {
    super()
    this.pool = dbPool
    this.embedder = embedder
    this.defaultTopK = Number(defaultTopK) || 5
    this.maxTopK = Number(maxTopK) || 20
    this.defaultMinSimilarity = Number(defaultMinSimilarity) || 0.25
  }

  /**
   * Retrieves top-K context chunks matching a semantic query with strict tenant isolation.
   *
   * @param {object} options
   * @param {string} options.query - Plaintext search query
   * @param {string} options.userId - Authenticated user UUID (for private resume/profile chunks)
   * @param {string} options.jobId - Target job UUID (for public job chunks)
   * @param {number} [options.limit=5] - Maximum number of chunks to return (1-20)
   * @param {number} [options.minSimilarity=0.25] - Minimum cosine similarity threshold
   * @param {string|null} [options.sourceType=null] - Optional filter for specific source ('resume' | 'application_profile' | 'job')
   * @returns {Promise<Array<object>>}
   */
  async retrieveContext({
    query,
    userId,
    jobId,
    limit = this.defaultTopK,
    minSimilarity = this.defaultMinSimilarity,
    sourceType = null,
  }) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('Search query is required and must be a non-empty string.')
    }
    if (!userId || !isUuid(userId)) {
      throw new Error('Valid authenticated user ID is required for secure retrieval.')
    }
    if (!jobId || !isUuid(jobId)) {
      throw new Error('Valid target job ID is required for context retrieval.')
    }

    const boundedLimit = Math.max(1, Math.min(this.maxTopK, Math.floor(Number(limit) || this.defaultTopK)))
    const minSim = typeof minSimilarity === 'number' ? minSimilarity : this.defaultMinSimilarity

    // 1. Generate Query Vector Embedding using local Ollama model (all-minilm)
    const queryEmbedResult = await this.embedder.embedText(query.trim())
    const queryVector = queryEmbedResult.embedding

    // 2. Perform Cosine Similarity Search in PostgreSQL
    // Strict isolation: Chunks must either belong to this authenticated user OR be part of the target job posting
    const sql = `
      SELECT
        id,
        user_id,
        source_type,
        source_id,
        chunk_id,
        content,
        content_hash,
        embedding_model,
        dimension,
        metadata,
        (SELECT SUM(a * b) FROM ROWS FROM (UNNEST(embedding), UNNEST($1::float8[])) AS t(a, b)) AS similarity
      FROM ai_embeddings
      WHERE (
        -- Authenticated user's private data (resume & profile)
        (user_id = $2::uuid AND source_type IN ('resume', 'application_profile'))
        OR
        -- Target job's public posting data
        (source_type = 'job' AND source_id = $3::uuid)
      )
      AND ($4::varchar IS NULL OR source_type = $4)
      AND (SELECT SUM(a * b) FROM ROWS FROM (UNNEST(embedding), UNNEST($1::float8[])) AS t(a, b)) >= $5
      ORDER BY similarity DESC
      LIMIT $6
    `

    const values = [
      queryVector,
      userId,
      jobId,
      sourceType || null,
      minSim,
      boundedLimit,
    ]

    try {
      const result = await this.pool.query(sql, values)
      return result.rows.map((row) => ({
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        user_id: row.user_id,
        chunk_id: row.chunk_id,
        content: row.content,
        similarity: row.similarity != null ? Number(Number(row.similarity).toFixed(4)) : 0,
        metadata: row.metadata || {},
      }))
    } catch (err) {
      logger.error('Failed to retrieve semantic context from PostgreSQL embeddings', {
        userId,
        jobId,
        error: err.message,
      })
      throw new Error(`RETRIEVAL_FAILED: ${err.message}`)
    }
  }

  /**
   * Retrieves top-K context chunks for candidate data only (resume and application profile).
   *
   * @param {object} options
   * @param {string} options.query - Plaintext search query
   * @param {string} options.userId - Authenticated user UUID
   * @param {number} [options.limit=5] - Maximum number of chunks to return (1-20)
   * @param {number} [options.minSimilarity=0.25] - Minimum cosine similarity threshold
   * @param {string|null} [options.sourceType=null] - Optional filter ('resume' | 'application_profile')
   * @returns {Promise<Array<object>>}
   */
  async retrieveCandidateContext({
    query,
    userId,
    limit = this.defaultTopK,
    minSimilarity = this.defaultMinSimilarity,
    sourceType = null,
  }) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('Search query is required and must be a non-empty string.')
    }
    if (!userId || !isUuid(userId)) {
      throw new Error('Valid authenticated user ID is required for secure retrieval.')
    }

    const boundedLimit = Math.max(1, Math.min(this.maxTopK, Math.floor(Number(limit) || this.defaultTopK)))
    const minSim = typeof minSimilarity === 'number' ? minSimilarity : this.defaultMinSimilarity

    // 1. Generate Query Vector Embedding using local Ollama model (all-minilm)
    const queryEmbedResult = await this.embedder.embedText(query.trim())
    const queryVector = queryEmbedResult.embedding

    // 2. Perform Cosine Similarity Search in PostgreSQL scoped only to this candidate's private data
    const sql = `
      SELECT
        id,
        user_id,
        source_type,
        source_id,
        chunk_id,
        content,
        content_hash,
        embedding_model,
        dimension,
        metadata,
        (SELECT SUM(a * b) FROM ROWS FROM (UNNEST(embedding), UNNEST($1::float8[])) AS t(a, b)) AS similarity
      FROM ai_embeddings
      WHERE (
        user_id = $2::uuid AND source_type IN ('resume', 'application_profile')
      )
      AND ($3::varchar IS NULL OR source_type = $3)
      AND (SELECT SUM(a * b) FROM ROWS FROM (UNNEST(embedding), UNNEST($1::float8[])) AS t(a, b)) >= $4
      ORDER BY similarity DESC
      LIMIT $5
    `

    const values = [
      queryVector,
      userId,
      sourceType || null,
      minSim,
      boundedLimit,
    ]

    try {
      const result = await this.pool.query(sql, values)
      return result.rows.map((row) => ({
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        user_id: row.user_id,
        chunk_id: row.chunk_id,
        content: row.content,
        similarity: row.similarity != null ? Number(Number(row.similarity).toFixed(4)) : 0,
        metadata: row.metadata || {},
      }))
    } catch (err) {
      logger.error('Failed to retrieve candidate semantic context from PostgreSQL embeddings', {
        userId,
        error: err.message,
      })
      throw new Error(`RETRIEVAL_FAILED: ${err.message}`)
    }
  }
}

export const retrievalService = new RetrievalService()
