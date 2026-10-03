import { pool } from '../db.js'

const autoApplyFields = [
  'enabled',
  'minimum_match_percentage',
  'allowed_job_sources',
  'allowed_employment_types',
  'allowed_work_modes',
  'require_resume',
  'require_complete_profile',
]

const autoApplySelection = `
  id,
  user_id,
  enabled,
  minimum_match_percentage,
  allowed_job_sources,
  allowed_employment_types,
  allowed_work_modes,
  require_resume,
  require_complete_profile,
  created_at,
  updated_at
`

export class AutoApplyRepository {
  async findByUserId(userId, client = pool) {
    const result = await client.query(
      `SELECT ${autoApplySelection} FROM auto_apply_settings WHERE user_id = $1`,
      [userId],
    )
    return result.rows[0] ?? null
  }

  async upsertSettings(userId, data, client = pool) {
    const values = [
      userId,
      data.enabled ?? false,
      data.minimum_match_percentage ?? 80,
      data.allowed_job_sources ?? ['direct', 'recruiter'],
      data.allowed_employment_types ?? ['full-time', 'contract', 'part-time'],
      data.allowed_work_modes ?? ['remote', 'hybrid', 'onsite'],
      data.require_resume ?? true,
      data.require_complete_profile ?? true,
    ]

    const result = await client.query(
      `INSERT INTO auto_apply_settings (
        user_id, enabled, minimum_match_percentage, allowed_job_sources,
        allowed_employment_types, allowed_work_modes, require_resume,
        require_complete_profile
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        minimum_match_percentage = EXCLUDED.minimum_match_percentage,
        allowed_job_sources = EXCLUDED.allowed_job_sources,
        allowed_employment_types = EXCLUDED.allowed_employment_types,
        allowed_work_modes = EXCLUDED.allowed_work_modes,
        require_resume = EXCLUDED.require_resume,
        require_complete_profile = EXCLUDED.require_complete_profile,
        updated_at = NOW()
      RETURNING ${autoApplySelection}`,
      values,
    )
    return result.rows[0]
  }

  async updateSettings(userId, partialData, client = pool) {
    const fieldsToUpdate = autoApplyFields.filter((field) => partialData[field] !== undefined)
    if (!fieldsToUpdate.length) {
      return this.findByUserId(userId, client)
    }

    const values = fieldsToUpdate.map((field) => partialData[field])
    const assignments = fieldsToUpdate.map((field, index) => `${field} = $${index + 1}`)
    values.push(userId)

    const result = await client.query(
      `UPDATE auto_apply_settings
       SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE user_id = $${values.length}
       RETURNING ${autoApplySelection}`,
      values,
    )
    return result.rows[0] ?? null
  }
}

export const autoApplyRepository = new AutoApplyRepository()
