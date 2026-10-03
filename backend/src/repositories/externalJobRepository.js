/**
 * TechNova Job Application Assistant
 * External Job Repository
 * Handles database operations for normalized external job postings.
 */

import { pool } from '../db.js'
import { computeJobFingerprint } from '../services/externalJobs/fingerprint.js'
import { getProviderPolicy } from '../services/externalJobs/providerPolicies.js'

export class ExternalJobRepository {
  /**
   * Upserts a single normalized external job record.
   * Updates last_seen_at and refreshed metadata on conflict.
   * @param {object} job
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<object>}
   */
  async upsertJob(job, client = pool) {
    const fingerprint = job.fingerprint || computeJobFingerprint({
      company: job.company,
      title: job.title,
      location: job.location,
      remote_type: job.remote_type,
      employment_type: job.employment_type,
    })

    const policy = getProviderPolicy(job.source)
    const attribution = job.attribution || policy.attribution

    let expiresAt = job.expires_at || null
    if (!expiresAt && policy.retentionDays) {
      const d = new Date()
      d.setDate(d.getDate() + policy.retentionDays)
      expiresAt = d.toISOString()
    }

    const query = `
      INSERT INTO external_jobs (
        source,
        external_id,
        canonical_url,
        title,
        company,
        location,
        description,
        employment_type,
        remote_type,
        industry,
        salary_min,
        salary_max,
        currency,
        posted_at,
        first_seen_at,
        last_seen_at,
        last_provider_update_at,
        expires_at,
        fingerprint,
        raw_metadata,
        attribution
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, NOW(), NOW(), $15, $16, $17, $18, $19
      )
      ON CONFLICT (source, external_id) DO UPDATE SET
        canonical_url = EXCLUDED.canonical_url,
        title = EXCLUDED.title,
        company = EXCLUDED.company,
        location = EXCLUDED.location,
        description = EXCLUDED.description,
        employment_type = EXCLUDED.employment_type,
        remote_type = EXCLUDED.remote_type,
        industry = EXCLUDED.industry,
        salary_min = EXCLUDED.salary_min,
        salary_max = EXCLUDED.salary_max,
        currency = EXCLUDED.currency,
        posted_at = COALESCE(EXCLUDED.posted_at, external_jobs.posted_at),
        last_seen_at = NOW(),
        last_provider_update_at = COALESCE(EXCLUDED.last_provider_update_at, external_jobs.last_provider_update_at),
        expires_at = EXCLUDED.expires_at,
        fingerprint = EXCLUDED.fingerprint,
        raw_metadata = EXCLUDED.raw_metadata,
        attribution = EXCLUDED.attribution,
        updated_at = NOW()
      RETURNING *
    `

    const values = [
      job.source,
      String(job.external_id),
      job.source_url || job.canonical_url,
      job.title,
      job.company,
      job.location || null,
      job.description || null,
      job.employment_type || 'full-time',
      job.remote_type || null,
      job.industry || null,
      job.salary_min != null ? Number(job.salary_min) : null,
      job.salary_max != null ? Number(job.salary_max) : null,
      job.currency || null,
      job.posted_at ? new Date(job.posted_at).toISOString() : null,
      job.last_provider_update_at ? new Date(job.last_provider_update_at).toISOString() : null,
      expiresAt ? new Date(expiresAt).toISOString() : null,
      fingerprint,
      JSON.stringify(job.metadata || {}),
      JSON.stringify(attribution || {}),
    ]

    const result = await client.query(query, values)
    return result.rows[0]
  }

  /**
   * Upserts a batch of normalized external jobs.
   * @param {Array<object>} jobs
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<Array<object>>}
   */
  async upsertBatch(jobs, client = pool) {
    if (!Array.isArray(jobs) || jobs.length === 0) return []

    const saved = []
    for (const job of jobs) {
      try {
        const row = await this.upsertJob(job, client)
        saved.push(row)
      } catch (err) {
        console.error('Failed to upsert external job:', err.message)
      }
    }
    return saved
  }

  /**
   * Retrieves an external job by ID.
   * @param {string} id
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<object|null>}
   */
  async findById(id, client = pool) {
    const result = await client.query('SELECT * FROM external_jobs WHERE id = $1', [id])
    return result.rows[0] || null
  }

  /**
   * Retrieves external jobs by an array of IDs preserving original array order.
   * @param {Array<string>} ids
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<Array<object>>}
   */
  async findByIds(ids, client = pool) {
    if (!Array.isArray(ids) || ids.length === 0) return []

    const result = await client.query(
      'SELECT * FROM external_jobs WHERE id = ANY($1::uuid[])',
      [ids],
    )

    const map = new Map(result.rows.map((row) => [row.id, row]))
    return ids.map((id) => map.get(id)).filter(Boolean)
  }

  /**
   * Finds jobs matching a content fingerprint.
   * @param {string} fingerprint
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<Array<object>>}
   */
  async findByFingerprint(fingerprint, client = pool) {
    const result = await client.query(
      'SELECT * FROM external_jobs WHERE fingerprint = $1 ORDER BY posted_at DESC NULLS LAST',
      [fingerprint],
    )
    return result.rows
  }

  /**
   * Prunes or marks stale jobs that have not been seen in the specified number of days.
   * @param {number} [days=14]
   * @param {import('pg').PoolClient} [client=pool]
   * @returns {Promise<number>} Number of pruned/deleted rows
   */
  async pruneStaleJobs(days = 14, client = pool) {
    const safeDays = Math.max(1, Math.floor(Number(days) || 14))
    const result = await client.query(
      `DELETE FROM external_jobs
       WHERE last_seen_at < NOW() - ($1 || ' days')::interval
       RETURNING id`,
      [safeDays],
    )
    return result.rowCount || 0
  }
}

export const externalJobRepository = new ExternalJobRepository()
