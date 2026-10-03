/**
 * TechNova Job Application Assistant
 * Step 12.2 — AI Embedding Repository
 * Data access layer for vector embeddings in PostgreSQL.
 */

import { pool } from '../db.js'

export async function ensureEmbeddingSchema(dbPool = pool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ai_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      source_type VARCHAR(50) NOT NULL,
      source_id UUID NOT NULL,
      chunk_id VARCHAR(100) NOT NULL,
      content TEXT NOT NULL,
      content_hash VARCHAR(64) NOT NULL,
      embedding REAL[] NOT NULL,
      embedding_model VARCHAR(100) NOT NULL,
      dimension INT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_ai_embeddings_chunk UNIQUE (source_type, source_id, chunk_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ai_embeddings_source ON ai_embeddings(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_ai_embeddings_user ON ai_embeddings(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_embeddings_hash ON ai_embeddings(content_hash);
  `)
}

export class EmbeddingRepository {
  constructor(dbPool = pool) {
    this.pool = dbPool
  }

  async ensureSchema() {
    return ensureEmbeddingSchema(this.pool)
  }

  /**
   * Upserts an embedding record with deterministic content hash and vector.
   */
  async upsertEmbedding({
    userId = null,
    sourceType,
    sourceId,
    chunkId,
    content,
    contentHash,
    embedding,
    model = 'all-minilm',
    dimension = 384,
    metadata = {},
  }) {
    if (!sourceType || !sourceId || !chunkId || !content || !contentHash || !Array.isArray(embedding)) {
      throw new Error('Missing required embedding fields for upsert.')
    }

    const query = `
      INSERT INTO ai_embeddings (
        user_id, source_type, source_id, chunk_id, content, content_hash,
        embedding, embedding_model, dimension, metadata, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::real[], $8, $9, $10, NOW()
      )
      ON CONFLICT (source_type, source_id, chunk_id)
      DO UPDATE SET
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model,
        dimension = EXCLUDED.dimension,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id, user_id, source_type, source_id, chunk_id, content_hash, embedding_model, dimension, created_at, updated_at
    `

    const values = [
      userId || null,
      sourceType,
      sourceId,
      chunkId,
      content,
      contentHash,
      embedding,
      model,
      dimension,
      JSON.stringify(metadata || {}),
    ]

    const result = await this.pool.query(query, values)
    return result.rows[0]
  }

  /**
   * Finds all stored chunks for a source.
   */
  async findBySource({ sourceType, sourceId }) {
    const result = await this.pool.query(
      `SELECT id, user_id, source_type, source_id, chunk_id, content, content_hash,
              embedding, embedding_model, dimension, metadata, created_at, updated_at
       FROM ai_embeddings
       WHERE source_type = $1 AND source_id = $2
       ORDER BY chunk_id ASC`,
      [sourceType, sourceId],
    )
    return result.rows
  }

  /**
   * Finds embedding by exact content hash.
   */
  async findByContentHash(contentHash) {
    const result = await this.pool.query(
      `SELECT id, user_id, source_type, source_id, chunk_id, content, content_hash,
              embedding, embedding_model, dimension, metadata, created_at, updated_at
       FROM ai_embeddings
       WHERE content_hash = $1
       LIMIT 1`,
      [contentHash],
    )
    return result.rows[0] || null
  }

  /**
   * Deletes all embeddings for a source.
   */
  async deleteBySource({ sourceType, sourceId }) {
    const result = await this.pool.query(
      'DELETE FROM ai_embeddings WHERE source_type = $1 AND source_id = $2 RETURNING id',
      [sourceType, sourceId],
    )
    return result.rowCount
  }

  /**
   * Queries top-K nearest embeddings using cosine similarity.
   */
  async findSimilar({
    embedding,
    sourceType = null,
    userId = null,
    limit = 5,
    minSimilarity = -1.0,
  }) {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Query vector must be a non-empty array of numbers.')
    }

    const query = `
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
        created_at,
        (SELECT SUM(a * b) FROM ROWS FROM (UNNEST(embedding), UNNEST($1::float8[])) AS t(a, b)) AS similarity
      FROM ai_embeddings
      WHERE ($2::varchar IS NULL OR source_type = $2)
        AND ($3::uuid IS NULL OR user_id = $3 OR user_id IS NULL)
      ORDER BY similarity DESC
      LIMIT $4
    `

    const values = [
      embedding,
      sourceType || null,
      userId || null,
      Math.max(1, Math.min(50, limit)),
    ]

    const result = await this.pool.query(query, values)
    return result.rows
      .map((row) => ({
        ...row,
        similarity: row.similarity != null ? Number(Number(row.similarity).toFixed(6)) : 0,
      }))
      .filter((row) => row.similarity >= minSimilarity)
  }

  /**
   * Total count of embeddings in database.
   */
  async count({ sourceType = null } = {}) {
    if (sourceType) {
      const res = await this.pool.query(
        'SELECT COUNT(*)::int AS count FROM ai_embeddings WHERE source_type = $1',
        [sourceType],
      )
      return res.rows[0].count
    }
    const res = await this.pool.query('SELECT COUNT(*)::int AS count FROM ai_embeddings')
    return res.rows[0].count
  }
}

export const embeddingRepository = new EmbeddingRepository()
