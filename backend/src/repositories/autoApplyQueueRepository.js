/**
 * TechNova Job Application Assistant
 * Auto-Apply Queue Repository
 * Data access layer for auto-apply queue records in PostgreSQL.
 */

import { pool } from '../db.js'

const queueSelection = `
  q.id,
  q.user_id,
  q.job_id,
  q.job_source,
  q.status,
  q.match_score,
  q.failure_reason,
  q.application_id,
  q.created_at,
  q.updated_at,
  q.applied_at,
  j.company,
  j.title AS role,
  j.location,
  j.remote_type,
  j.salary_min,
  j.salary_max,
  j.currency
`

export class AutoApplyQueueRepository {
  constructor(dbPool = pool) {
    this.pool = dbPool
  }

  async findByUserId(userId, { status = null, limit = 50 } = {}) {
    const values = [userId]
    const conditions = ['q.user_id = $1']

    if (status) {
      values.push(status)
      conditions.push(`q.status = $${values.length}`)
    }

    values.push(limit)
    const query = `
      SELECT ${queueSelection}
      FROM auto_apply_queue q
      LEFT JOIN jobs j ON j.id = q.job_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY q.created_at DESC
      LIMIT $${values.length}
    `

    const result = await this.pool.query(query, values)
    return result.rows
  }

  async findByUserAndJob(userId, jobId) {
    const query = `
      SELECT ${queueSelection}
      FROM auto_apply_queue q
      LEFT JOIN jobs j ON j.id = q.job_id
      WHERE q.user_id = $1 AND q.job_id = $2
      LIMIT 1
    `
    const result = await this.pool.query(query, [userId, jobId])
    return result.rows[0] || null
  }

  async upsertQueueItem({
    userId,
    jobId,
    jobSource = 'internal',
    status = 'queued',
    matchScore = null,
    failureReason = null,
  }) {
    const query = `
      INSERT INTO auto_apply_queue (
        user_id, job_id, job_source, status, match_score, failure_reason
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, job_id) DO UPDATE SET
        status = EXCLUDED.status,
        match_score = COALESCE(EXCLUDED.match_score, auto_apply_queue.match_score),
        failure_reason = EXCLUDED.failure_reason,
        updated_at = NOW()
      RETURNING *
    `
    const result = await this.pool.query(query, [
      userId,
      jobId,
      jobSource,
      status,
      matchScore,
      failureReason,
    ])
    return result.rows[0]
  }

  async updateStatus(queueId, userId, { status, failureReason = null, applicationId = null, appliedAt = null }) {
    const values = [status, failureReason, applicationId, appliedAt, queueId, userId]
    const query = `
      UPDATE auto_apply_queue
      SET status = $1,
          failure_reason = $2,
          application_id = COALESCE($3, application_id),
          applied_at = COALESCE($4, applied_at),
          updated_at = NOW()
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `
    const result = await this.pool.query(query, values)
    return result.rows[0] || null
  }

  async getQueueSummary(userId) {
    const query = `
      SELECT status, COUNT(*)::int AS count
      FROM auto_apply_queue
      WHERE user_id = $1
      GROUP BY status
    `
    const result = await this.pool.query(query, [userId])
    const counts = {
      eligible: 0,
      queued: 0,
      processing: 0,
      applied: 0,
      failed: 0,
      blocked: 0,
    }
    for (const row of result.rows) {
      if (counts[row.status] !== undefined) {
        counts[row.status] = row.count
      }
    }
    return counts
  }
}

export const autoApplyQueueRepository = new AutoApplyQueueRepository()
