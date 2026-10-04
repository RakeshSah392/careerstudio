import { Router } from 'express'
import { pool } from '../db.js'
import { isOptionalString, isUuid } from '../lib/validation.js'
import { requireSameUser } from '../middleware/requireAuth.js'

const router = Router()
const stages = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected']
const selection = `id, user_id, job_id, company, role, location, source_url, status, applied_at`

router.get('/', async (request, response) => {
  const { user_id: userId, status } = request.query
  if (userId && !isUuid(userId)) return response.status(400).json({ error: 'Invalid user ID.' })
  if (!requireSameUser(request, response, userId)) return
  if (status && !stages.includes(status)) return response.status(400).json({ error: 'Invalid application stage.' })
  const values = [request.user.id]
  const conditions = ['user_id = $1']
  if (status) {
    values.push(status)
    conditions.push(`status = $${values.length}`)
  }
  const result = await pool.query(
    `SELECT ${selection} FROM applications ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY applied_at DESC, created_at DESC`,
    values,
  )
  response.json(result.rows)
})

router.post('/', async (request, response) => {
  const body = request.body ?? {}
  const { user_id: requestedUserId, job_id: jobId = null, status = 'Saved' } = body
  if (requestedUserId && !isUuid(requestedUserId)) return response.status(400).json({ error: 'Invalid user_id.' })
  if (!requireSameUser(request, response, requestedUserId)) return
  if (jobId && !isUuid(jobId)) return response.status(400).json({ error: 'Invalid job_id.' })
  if (!stages.includes(status)) return response.status(400).json({ error: 'Invalid application stage.' })

  let job = null
  if (jobId) {
    const result = await pool.query('SELECT company, title, location, source_url, created_by_user_id FROM jobs WHERE id = $1', [jobId])
    if (!result.rowCount) return response.status(404).json({ error: 'Job not found.' })
    job = result.rows[0]
  }

  const company = body.company ?? job?.company
  const role = body.role ?? job?.title
  const location = body.location ?? job?.location ?? ''
  const sourceUrl = body.source_url ?? job?.source_url ?? ''
  if (typeof company !== 'string' || !company.trim() || typeof role !== 'string' || !role.trim()) {
    return response.status(400).json({ error: 'Company and role are required unless a job_id is supplied.' })
  }
  if (![location, sourceUrl].every(isOptionalString)) {
    return response.status(400).json({ error: 'Location and source_url must be text.' })
  }

  const result = await pool.query(
    `INSERT INTO applications (user_id, job_id, company, role, location, source_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${selection}`,
    [request.user.id, jobId, company.trim(), role.trim(), location.trim(), sourceUrl.trim(), status],
  )

  const application = result.rows[0]

  if (job?.created_by_user_id && status === 'Applied') {
    const applicantName = request.user.full_name || 'A candidate'
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_job_id, related_application_id, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
      [
        job.created_by_user_id,
        'new_application',
        'New application received',
        `${applicantName} submitted an application for "${job.title}".`,
        jobId,
        application.id,
      ],
    )
  }

  response.status(201).json(application)
})

router.get('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid application ID.' })
  const result = await pool.query(
    `SELECT ${selection} FROM applications WHERE id = $1 AND user_id = $2`,
    [request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Application not found.' })
  response.json(result.rows[0])
})

router.patch('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid application ID.' })

  const role = request.user.role || 'job_seeker'

  if (!['employer', 'recruiter'].includes(role)) {
  return response.status(403).json({
    error: 'Job seekers cannot change application status.',
  })
}

  const { status } = request.body ?? {}
  if (!status || !stages.includes(status)) {
    return response.status(400).json({ error: 'Invalid application stage.' })
  }

  const result = await pool.query(
    `UPDATE applications a
     SET status = $1, updated_at = NOW()
     FROM jobs j
     WHERE a.id = $2
       AND a.job_id = j.id
       AND j.created_by_user_id = $3
     RETURNING a.id, a.user_id, a.job_id, a.company, a.role, a.location, a.source_url, a.status, a.applied_at`,
    [status, request.params.id, request.user.id],
  )

  if (!result.rowCount) return response.status(404).json({ error: 'Application not found.' })

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
      appRow.id,
    ],
  )

  response.json(appRow)
})

router.delete('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid application ID.' })
  const result = await pool.query(
    'DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id',
    [request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Application not found.' })
  response.status(204).end()
})

export default router