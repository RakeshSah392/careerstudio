/**
 * TechNova Job Application Assistant
 * Step 12.2 — Local Ollama Embedding Provider Adapter
 * Generates vector representations using local Ollama and normalizes to unit vectors.
 */

import { createHash } from 'node:crypto'
import { EmbeddingProviderInterface } from '../aiContracts.js'
import { logger } from '../../../lib/logger.js'

/**
 * Normalizes a vector to unit L2 norm so dot-product equals cosine similarity.
 */
export function normalizeL2(vector) {
  if (!Array.isArray(vector) || vector.length === 0) return vector
  let sumSq = 0
  for (let i = 0; i < vector.length; i++) {
    sumSq += vector[i] * vector[i]
  }
  const norm = Math.sqrt(sumSq)
  if (norm === 0) return vector
  return vector.map((val) => Number((val / norm).toFixed(6)))
}

/**
 * Deterministic fallback feature-hashing embedding (384 dimensions)
 * Used if local Ollama daemon was launched without the `--embeddings` flag.
 */
export function generateDeterministicEmbedding(text, dimension = 384) {
  const clean = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const vec = new Array(dimension).fill(0)
  if (!clean) return vec

  // Subword n-grams (1 to 4 chars)
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i <= clean.length - n; i++) {
      const ngram = clean.slice(i, i + n)
      const hash = createHash('md5').update(ngram).digest()
      const idx = hash.readUInt16BE(0) % dimension
      const sign = (hash[2] % 2 === 0) ? 1 : -1
      vec[idx] += sign * (1 / Math.sqrt(n))
    }
  }

  return normalizeL2(vec)
}

export class OllamaEmbeddingProvider extends EmbeddingProviderInterface {
  constructor({
    baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model = process.env.OLLAMA_EMBED_MODEL || 'all-minilm',
    dimension = 384,
    timeoutMs = Number(process.env.OLLAMA_EMBED_TIMEOUT_MS) || 20000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    super()
    this.baseUrl = String(baseUrl).replace(/\/$/, '')
    this.model = String(model)
    this.dimension = Number(dimension) || 384
    this.timeoutMs = Number(timeoutMs) || 20000
    this.fetchImpl = fetchImpl
  }

  getName() {
    return 'ollama'
  }

  getModel() {
    return this.model
  }

  getDimension() {
    return this.dimension
  }

  async healthCheck() {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        return { available: false, provider: 'ollama', status: response.status }
      }
      return {
        available: true,
        provider: 'ollama',
        model: this.model,
        dimension: this.dimension,
      }
    } catch (err) {
      return { available: false, provider: 'ollama', error: err.message }
    }
  }

  /**
   * Generates a single text embedding vector.
   *
   * @param {string} text - Clean text to embed
   * @returns {Promise<{ embedding: number[], dimension: number, model: string }>}
   */
  async embedText(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('text is required and must be a string.')
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data?.embedding) && data.embedding.length > 0) {
          const rawVector = data.embedding
          const normalized = normalizeL2(rawVector)
          return {
            embedding: normalized,
            dimension: normalized.length,
            model: this.model,
          }
        }
      }

      // If Ollama daemon returned non-200 or missing embedding support, log notice
      logger.info('Ollama embeddings unavailable; using deterministic local embedding vector', {
        model: this.model,
      })
    } catch (err) {
      logger.warn('Ollama embedding request failed, falling back to deterministic local embedding', {
        model: this.model,
        error: err.message,
      })
    }

    // Deterministic resilient local vector (always valid unit vector)
    const fallbackVec = generateDeterministicEmbedding(text, this.dimension)
    return {
      embedding: fallbackVec,
      dimension: this.dimension,
      model: `${this.model}:local_fallback`,
    }
  }

  /**
   * Generates embeddings for a batch of texts.
   *
   * @param {string[]} texts - Array of texts
   * @returns {Promise<Array<{ embedding: number[], dimension: number, model: string }>>}
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts)) {
      throw new Error('texts must be an array.')
    }

    const results = []
    for (const text of texts) {
      results.push(await this.embedText(text))
    }
    return results
  }
}
