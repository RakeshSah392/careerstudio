import { Router } from 'express'
import { pool } from '../db.js'
import { isOptionalString, isUuid } from '../lib/validation.js'
import { requireAuth, requireEmployer } from '../middleware/requireAuth.js'
import { readResumeFile } from '../services/resumeStorage.js'

const router = Router()
const emailPattern = /^\S+@\S+\.\S+$/
const validApplicantStages = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected']

function validateEmployerProfile(body, { partial = false } = {}) {
  const {
    company_name,
    company_website,
    company_description,
    recruiter_name,
    recruiter_email,
    recruiter_phone,
  } = body ?? {}

  for (const [key, val] of Object.entries({
    company_name,
    company_website,
    company_description,
    recruiter_name,
    recruiter_email,
    recruiter_phone,
  })) {
    if (val !== undefined && typeof val !== 'string') {
      return `${key} must be text.`
    }
  }

  if (!partial || company_name !== undefined) {
    if (typeof company_name !== 'string' || !company_name.trim()) {
      return 'Company name is required.'
    }
  }

  if (!partial || recruiter_name !== undefined) {
    if (typeof recruiter_name !== 'string' || !recruiter_name.trim()) {
      return 'Recruiter name is required.'
    }
  }

  if (!partial || recruiter_email !== undefined) {
    if (typeof recruiter_email !== 'string' || !emailPattern.test(recruiter_email.trim())) {
      return 'A valid recruiter email address is required.'
    }
  }

  return null
}

// 1. Role Upgrade & Onboarding (available to authenticated job_seekers and employers)
router.post('/onboard', requireAuth, async (request, response) => {
  const error = validateEmployerProfile(request.body, { partial: false })
  if (error) return response.status(400).json({ error })

  const {
    company_name,
    company_website = '',
    company_description = '',
    recruiter_name,
    recruiter_email,
    recruiter_phone = '',
  } = request.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Update user role to employer if not already employer or recruiter
    const currentRole = request.user.role || 'job_seeker'
    let updatedRole = currentRole
    if (currentRole === 'job_seeker') {
      updatedRole = 'employer'
      await client.query(
        `UPDATE users SET role = 'employer', updated_at = NOW() WHERE id = $1`,
        [request.user.id],
      )
    }

    const profileResult = await client.query(
      `INSERT INTO employer_profiles (
        user_id, company_name, company_website, company_description,
        recruiter_name, recruiter_email, recruiter_phone
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        company_website = EXCLUDED.company_website,
        company_description = EXCLUDED.company_description,
        recruiter_name = EXCLUDED.recruiter_name,
        recruiter_email = EXCLUDED.recruiter_email,
        recruiter_phone = EXCLUDED.recruiter_phone,
        updated_at = NOW()
      RETURNING id, user_id, company_name, company_website, company_description,
                recruiter_name, recruiter_email, recruiter_phone, created_at, updated_at`,
      [
        request.user.id,
        company_name.trim(),
        company_website.trim(),
        company_description.trim(),
        recruiter_name.trim(),
        recruiter_email.trim().toLowerCase(),
        recruiter_phone.trim(),
      ],
    )

    await client.query('COMMIT')

    const userObj = {
      ...request.user,
      role: updatedRole,
    }

    return response.status(200).json({
      user: userObj,
      profile: profileResult.rows[0],
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
})

// 2. GET current employer profile (guarded by requireEmployer)
router.get('/profile', requireAuth, requireEmployer, async (request, response) => {
  const result = await pool.query(
    `SELECT id, user_id, company_name, company_website, company_description,
            recruiter_name, recruiter_email, recruiter_phone, created_at, updated_at
     FROM employer_profiles
     WHERE user_id = $1`,
    [request.user.id],
  )

  if (!result.rowCount) {
    return response.status(404).json({ error: 'Employer profile not found.' })
  }

  return response.json({ profile: result.rows[0] })
})

// 3. PATCH current employer profile (guarded by requireEmployer)
router.patch('/profile', requireAuth, requireEmployer, async (request, response) => {
  const error = validateEmployerProfile(request.body, { partial: true })
  if (error) return response.status(400).json({ error })

  const {
    company_name,
    company_website,
    company_description,
    recruiter_name,
    recruiter_email,
    recruiter_phone,
  } = request.body

  const fields = []
  const values = []

  if (company_name !== undefined) {
    values.push(company_name.trim())
    fields.push(`company_name = $${values.length}`)
  }
  if (company_website !== undefined) {
    values.push(company_website.trim())
    fields.push(`company_website = $${values.length}`)
  }
  if (company_description !== undefined) {
    values.push(company_description.trim())
    fields.push(`company_description = $${values.length}`)
  }
  if (recruiter_name !== undefined) {
    values.push(recruiter_name.trim())
    fields.push(`recruiter_name = $${values.length}`)
  }
  if (recruiter_email !== undefined) {
    values.push(recruiter_email.trim().toLowerCase())
    fields.push(`recruiter_email = $${values.length}`)
  }
  if (recruiter_phone !== undefined) {
    values.push(recruiter_phone.trim())
    fields.push(`recruiter_phone = $${values.length}`)
  }

  if (!fields.length) {
    return response.status(400).json({ error: 'Provide at least one employer profile field to update.' })
  }

  values.push(request.user.id)
  const result = await pool.query(
    `UPDATE employer_profiles
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE user_id = $${values.length}
     RETURNING id, user_id, company_name, company_website, company_description,
               recruiter_name, recruiter_email, recruiter_phone, created_at, updated_at`,
    values,
  )

  if (!result.rowCount) {
    return response.status(404).json({ error: 'Employer profile not found.' })
  }

  return response.json({ profile: result.rows[0] })
})

// 4. GET all jobs posted by current employer (guarded by requireEmployer)
router.get('/jobs', requireAuth, requireEmployer, async (request, response) => {
  const result = await pool.query(
    `SELECT * FROM jobs
     WHERE created_by_user_id = $1
     ORDER BY posted_at DESC NULLS LAST, created_at DESC`,
    [request.user.id],
  )
  return response.json({ ok: true, jobs: result.rows })
})

// 5. GET applicants for jobs owned by employer
router.get('/applicants', requireAuth, requireEmployer, async (request, response) => {
  const { job_id, status } = request.query
  if (job_id && !isUuid(job_id)) {
    return response.status(400).json({ error: 'Invalid job_id filter.' })
  }
  if (status && !validApplicantStages.includes(status)) {
    return response.status(400).json({ error: 'Invalid status filter.' })
  }

  const values = [request.user.id]
  const conditions = ['j.created_by_user_id = $1']

  if (job_id) {
    values.push(job_id)
    conditions.push(`a.job_id = $${values.length}`)
  }

  if (status) {
    values.push(status)
    conditions.push(`a.status = $${values.length}`)
  }

  const query = `
    SELECT
      a.id,
      a.job_id,
      a.user_id,
      a.status,
      a.applied_at,
      a.created_at,
      j.title AS job_title,
      j.company AS job_company,
      j.location AS job_location,
      j.remote_type AS job_remote_type,
      j.status AS job_status,
      u.full_name AS applicant_name,
      u.email AS applicant_email,
      r.id AS resume_id,
      r.source_filename AS resume_file_name,
      r.file_size_bytes AS resume_file_size_bytes,
      r.created_at AS resume_created_at
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    JOIN users u ON a.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT id, source_filename, file_size_bytes, created_at
      FROM resumes
      WHERE user_id = a.user_id
      ORDER BY is_primary DESC, created_at DESC
      LIMIT 1
    ) r ON true
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC
  `

  const result = await pool.query(query, values)
  return response.json({ ok: true, applicants: result.rows })
})

// 6. PATCH update applicant status for a job owned by employer
router.patch('/applicants/:applicationId', requireAuth, requireEmployer, async (request, response) => {
  const { applicationId } = request.params
  if (!isUuid(applicationId)) {
    return response.status(400).json({ error: 'Invalid applicationId.' })
  }

  const { status } = request.body ?? {}
  if (!status || !validApplicantStages.includes(status)) {
    return response.status(400).json({ error: 'Invalid application status. Allowed: ' + validApplicantStages.join(', ') })
  }

  const result = await pool.query(
    `UPDATE applications a
     SET status = $1, updated_at = NOW()
     FROM jobs j
     WHERE a.id = $2
       AND a.job_id = j.id
       AND j.created_by_user_id = $3
     RETURNING a.id, a.user_id, a.job_id, a.status, a.applied_at, a.created_at, a.updated_at`,
    [status, applicationId, request.user.id],
  )

  if (!result.rowCount) {
    return response.status(404).json({ error: 'Applicant application not found.' })
  }

  const appRow = result.rows[0]
  const jobRes = await pool.query('SELECT title FROM jobs WHERE id = $1', [appRow.job_id])
  const jobTitle = jobRes.rows[0]?.title || 'the role'
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, related_job_id, related_application_id, is_read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
    [
      appRow.user_id,
      'application_status_changed',
      'Application status updated',
      `Your application for "${jobTitle}" has been moved to ${status}.`,
      appRow.job_id,
      applicationId,
    ],
  )

  return response.json(result.rows[0])
})

// 7. GET candidate resume file for an application owned by employer
router.get('/applicants/:applicationId/resume/file', requireAuth, requireEmployer, async (request, response) => {
  const { applicationId } = request.params
  if (!isUuid(applicationId)) {
    return response.status(400).json({ error: 'Invalid applicationId.' })
  }

  const appCheck = await pool.query(
    `SELECT a.id, a.user_id, r.storage_key, r.source_filename, r.mime_type
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     LEFT JOIN LATERAL (
       SELECT storage_key, source_filename, mime_type
       FROM resumes
       WHERE user_id = a.user_id
       ORDER BY is_primary DESC, created_at DESC
       LIMIT 1
     ) r ON true
     WHERE a.id = $1 AND j.created_by_user_id = $2`,
    [applicationId, request.user.id],
  )

  if (!appCheck.rowCount) {
    return response.status(404).json({ error: 'Application not found.' })
  }

  const row = appCheck.rows[0]
  if (!row.storage_key) {
    return response.status(404).json({ error: 'No resume file attached for this applicant.' })
  }

  const file = await readResumeFile(row.user_id, row.storage_key)
  if (!file) {
    return response.status(404).json({ error: 'Resume file not found on storage.' })
  }

  response
    .type(row.mime_type || 'application/octet-stream')
    .attachment(row.source_filename || 'candidate-resume')
    .set('Cache-Control', 'private, no-store')
    .set('X-Content-Type-Options', 'nosniff')
    .send(file)
})

// 8. GET employer dashboard summary and analytics
router.get('/dashboard', requireAuth, requireEmployer, async (request, response) => {
  const userId = request.user.id

  const [jobsSummaryRes, appsSummaryRes, perJobStatsRes, recentJobsRes, recentAppsRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total_jobs,
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_jobs,
         COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_jobs
       FROM jobs
       WHERE created_by_user_id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total_applications,
         COUNT(*) FILTER (WHERE a.status = 'Saved')::int AS saved_applications,
         COUNT(*) FILTER (WHERE a.status = 'Applied')::int AS applied_applications,
         COUNT(*) FILTER (WHERE a.status = 'Interview')::int AS interview_applications,
         COUNT(*) FILTER (WHERE a.status = 'Offer')::int AS offer_applications,
         COUNT(*) FILTER (WHERE a.status = 'Rejected')::int AS rejected_applications
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE j.created_by_user_id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT
         j.id,
         j.title,
         j.company,
         j.location,
         j.remote_type,
         j.employment_type,
         j.status,
         j.created_at,
         j.posted_at,
         COUNT(a.id)::int AS applicant_count,
         COUNT(a.id) FILTER (WHERE a.status = 'Interview')::int AS interview_count,
         COUNT(a.id) FILTER (WHERE a.status = 'Offer')::int AS offer_count,
         COUNT(a.id) FILTER (WHERE a.status = 'Rejected')::int AS rejected_count
       FROM jobs j
       LEFT JOIN applications a ON j.id = a.job_id
       WHERE j.created_by_user_id = $1
       GROUP BY j.id
       ORDER BY j.posted_at DESC NULLS LAST, j.created_at DESC`,
      [userId],
    ),
    pool.query(
      `SELECT id, title, company, location, remote_type, status, created_at, posted_at
       FROM jobs
       WHERE created_by_user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId],
    ),
    pool.query(
      `SELECT
         a.id,
         a.job_id,
         a.user_id,
         a.status,
         a.applied_at,
         a.created_at,
         j.title AS job_title,
         j.company AS job_company,
         u.full_name AS applicant_name,
         u.email AS applicant_email,
         r.id AS resume_id,
         r.source_filename AS resume_file_name
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       JOIN users u ON a.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT id, source_filename
         FROM resumes
         WHERE user_id = a.user_id
         ORDER BY is_primary DESC, created_at DESC
         LIMIT 1
       ) r ON true
       WHERE j.created_by_user_id = $1
       ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC
       LIMIT 10`,
      [userId],
    ),
  ])

  const jobsSummary = jobsSummaryRes.rows[0] || { total_jobs: 0, open_jobs: 0, closed_jobs: 0 }
  const appsSummary = appsSummaryRes.rows[0] || {
    total_applications: 0,
    saved_applications: 0,
    applied_applications: 0,
    interview_applications: 0,
    offer_applications: 0,
    rejected_applications: 0,
  }

  return response.json({
    ok: true,
    summary: {
      jobs: jobsSummary,
      applications: appsSummary,
    },
    jobs_analytics: perJobStatsRes.rows,
    recent_activity: {
      recent_jobs: recentJobsRes.rows,
      recent_applications: recentAppsRes.rows,
    },
  })
})

// 9. GET employer notifications
router.get('/notifications', requireAuth, requireEmployer, async (request, response) => {
  const userId = request.user.id
  const filter = request.query.filter

  const whereClause = filter === 'unread'
    ? 'WHERE user_id = $1 AND is_read = false'
    : 'WHERE user_id = $1'

  const [notifsRes, unreadRes] = await Promise.all([
    pool.query(
      `SELECT id, user_id, type, title, message, related_job_id, related_application_id, is_read, created_at
       FROM notifications
       ${whereClause}
       ORDER BY created_at DESC`,
      [userId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS unread_count
       FROM notifications
       WHERE user_id = $1 AND is_read = false`,
      [userId],
    ),
  ])

  return response.json({
    ok: true,
    notifications: notifsRes.rows,
    unread_count: unreadRes.rows[0]?.unread_count ?? 0,
  })
})

// 10. PATCH mark single notification as read
router.patch('/notifications/:id/read', requireAuth, requireEmployer, async (request, response) => {
  const { id } = request.params
  if (!isUuid(id)) {
    return response.status(400).json({ error: 'Invalid notification ID.' })
  }

  const result = await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, type, title, message, related_job_id, related_application_id, is_read, created_at`,
    [id, request.user.id],
  )

  if (!result.rowCount) {
    return response.status(404).json({ error: 'Notification not found.' })
  }

  return response.json({
    ok: true,
    notification: result.rows[0],
  })
})

// 11. POST mark all unread notifications as read
router.post('/notifications/read-all', requireAuth, requireEmployer, async (request, response) => {
  const result = await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE user_id = $1 AND is_read = false`,
    [request.user.id],
  )

  return response.json({
    ok: true,
    updated_count: result.rowCount,
  })
})

export default router
