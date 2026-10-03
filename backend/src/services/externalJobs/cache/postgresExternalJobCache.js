/**
 * TechNova Job Application Assistant
 * PostgreSQL-Backed External Job Cache
 * Implements bounded, TTL-based caching for external search queries.
 */

import { pool } from '../../../db.js'
import { ExternalJobCacheInterface } from './externalJobCacheInterface.js'

export class PostgresExternalJobCache extends ExternalJobCacheInterface {
  /**
   * Retrieves a cached search entry and checks freshness.
   * @param {string} cacheKey 
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<{ isHit: boolean, isStale: boolean, entry: object|null }>}
   */
  async get(cacheKey, client = pool) {
    if (!cacheKey) return { isHit: false, isStale: false, entry: null }

    const result = await client.query(
      `SELECT
        id,
        cache_key,
        source,
        query_params,
        result_job_ids,
        total_available,
        attribution,
        expires_at,
        created_at,
        updated_at,
        (NOW() > expires_at) AS is_stale
      FROM external_job_searches_cache
      WHERE cache_key = $1`,
      [cacheKey],
    )

    if (!result.rowCount) {
      return { isHit: false, isStale: false, entry: null }
    }

    const row = result.rows[0]
    return {
      isHit: true,
      isStale: Boolean(row.is_stale),
      entry: row,
    }
  }

  /**
   * Stores or refreshes search results in the cache with the given TTL.
   * @param {object} params
   * @param {string} params.cacheKey
   * @param {string} params.source
   * @param {object} params.queryParams
   * @param {Array<string>} params.resultJobIds
   * @param {number} params.totalAvailable
   * @param {object} params.attribution
   * @param {number} [params.ttlSeconds=3600]
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<object>}
   */
  async set(
    {
      cacheKey,
      source,
      queryParams,
      resultJobIds = [],
      totalAvailable = 0,
      attribution = {},
      ttlSeconds = 3600,
    },
    client = pool,
  ) {
    const safeTtl = Math.max(60, Math.floor(Number(ttlSeconds) || 3600))
    const expiresAt = new Date(Date.now() + safeTtl * 1000).toISOString()

    const query = `
      INSERT INTO external_job_searches_cache (
        cache_key,
        source,
        query_params,
        result_job_ids,
        total_available,
        attribution,
        expires_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (cache_key) DO UPDATE SET
        source = EXCLUDED.source,
        query_params = EXCLUDED.query_params,
        result_job_ids = EXCLUDED.result_job_ids,
        total_available = EXCLUDED.total_available,
        attribution = EXCLUDED.attribution,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
      RETURNING *
    `

    const values = [
      cacheKey,
      source,
      JSON.stringify(queryParams || {}),
      resultJobIds,
      Number(totalAvailable) || 0,
      JSON.stringify(attribution || {}),
      expiresAt,
    ]

    const result = await client.query(query, values)
    return result.rows[0]
  }

  /**
   * Invalidates an entry by its cache key.
   * @param {string} cacheKey 
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<boolean>}
   */
  async invalidate(cacheKey, client = pool) {
    const result = await client.query(
      'DELETE FROM external_job_searches_cache WHERE cache_key = $1',
      [cacheKey],
    )
    return (result.rowCount || 0) > 0
  }

  /**
   * Deletes expired cache records that are older than 24 hours to prevent table bloat.
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<number>}
   */
  async pruneExpired(client = pool) {
    const result = await client.query(
      "DELETE FROM external_job_searches_cache WHERE expires_at < NOW() - INTERVAL '24 hours'",
    )
    return result.rowCount || 0
  }
}

export const postgresExternalJobCache = new PostgresExternalJobCache()
