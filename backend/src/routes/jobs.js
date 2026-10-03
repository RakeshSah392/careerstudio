import { Router } from 'express'
import { pool } from '../db.js'
import { isOptionalString, isUuid } from '../lib/validation.js'
import { optionalAuth, requireAuth, requireEmployer } from '../middleware/requireAuth.js'
import { jobDiscoveryService } from '../services/unifiedJobs/jobDiscoveryService.js'

const router = Router()
const remoteTypes = ['remote', 'hybrid', 'onsite']
const jobStatuses = ['open', 'closed']
const textFields = ['company', 'title', 'location', 'employment_type', 'industry', 'description', 'source_url']
const editableFields = [...textFields, 'remote_type', 'salary_min', 'salary_max', 'currency', 'status', 'posted_at']

function validateJob(body, partial = false) {
  for (const field of textFields) {
    if (!isOptionalString(body[field])) return `${field} must be text.`
  }
  for (const field of ['company', 'title']) {
    if ((!partial || body[field] !== undefined) && !body[field]?.trim()) return `${field} is required.`
  }
  if (body.remote_type !== undefined && !remoteTypes.includes(body.remote_type)) return 'Invalid remote_type.'
  if (body.status !== undefined && !jobStatuses.includes(body.status)) return 'Invalid job status.'
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Za-z]{3}$/.test(body.currency))) {
    return 'currency must be a three-letter code.'
  }
  for (const field of ['salary_min', 'salary_max']) {
    const value = body[field]
    if (value !== undefined && value !== null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      return `${field} must be a non-negative number.`
    }
  }
  const minSalary = body.salary_min
  const maxSalary = body.salary_max
  if (minSalary != null && maxSalary != null && Number(minSalary) > Number(maxSalary)) {
    return 'salary_min cannot exceed salary_max.'
  }
  if (body.posted_at !== undefined && body.posted_at !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.posted_at)) {
    return 'posted_at must use YYYY-MM-DD format.'
  }
  return null
}

router.get('/', optionalAuth, async (request, response) => {
  const { status: requestedStatus = 'open', created_by_user_id: userId, q } = request.query
  if (!jobStatuses.includes(requestedStatus) && requestedStatus !== 'all') {
    return response.status(400).json({ error: 'Invalid job status filter.' })
  }
  if (userId && !isUuid(userId)) return response.status(400).json({ error: 'Invalid user ID.' })
  if (userId && (!request.user || userId !== request.user.id)) {
    return response.status(403).json({ error: 'You cannot access another user’s jobs.' })
  }
  const status = request.user ? requestedStatus : 'open'

  const values = []
  const conditions = []
  if (status !== 'all') {
    values.push(status)
    conditions.push(`status = $${values.length}`)
  }
  if (userId) {
    values.push(userId)
    conditions.push(`created_by_user_id = $${values.length}`)
  }
  if (typeof q === 'string' && q.trim()) {
    values.push(`%${q.trim()}%`)
    conditions.push(`(company ILIKE $${values.length} OR title ILIKE $${values.length} OR location ILIKE $${values.length})`)
  }
  const result = await pool.query(
    `SELECT * FROM jobs ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY posted_at DESC NULLS LAST, created_at DESC`,
    values,
  )
  response.json(result.rows)
})

router.post('/', requireAuth, requireEmployer, async (request, response) => {
  const body = request.body ?? {}
  const validationError = validateJob(body)
  if (validationError) return response.status(400).json({ error: validationError })

  const result = await pool.query(
    `INSERT INTO jobs
      (created_by_user_id, company, title, location, remote_type, employment_type, industry, description,
       source_url, salary_min, salary_max, currency, status, posted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      request.user.id,
      body.company.trim(),
      body.title.trim(),
      body.location?.trim() ?? '',
      body.remote_type ?? 'onsite',
      body.employment_type?.trim() || 'full-time',
      body.industry?.trim() ?? '',
      body.description ?? '',
      body.source_url?.trim() ?? '',
      body.salary_min ?? null,
      body.salary_max ?? null,
      body.currency?.toUpperCase() ?? 'USD',
      body.status ?? 'open',
      body.posted_at ?? null,
    ],
  )
  response.status(201).json(result.rows[0])
})

router.get('/discovery', optionalAuth, async (request, response) => {
  try {
    const {
      keywords = '',
      location = '',
      work_mode = 'any',
      employment_type = 'any',
      min_salary,
      source = 'all',
      country = 'in',
      sort = 'best_match',
      page = 1,
      results_per_page = 20,
      force_refresh,
    } = request.query

    const validSources = ['all', 'internal', 'adzuna', 'arbeitnow', 'jooble']
    if (source && !validSources.includes(String(source).toLowerCase().trim())) {
      return response.status(400).json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` })
    }

    if (page !== undefined && (isNaN(Number(page)) || Number(page) < 1 || !Number.isInteger(Number(page)))) {
      return response.status(400).json({ error: 'page must be a positive integer.' })
    }

    if (results_per_page !== undefined && (isNaN(Number(results_per_page)) || Number(results_per_page) < 1 || !Number.isInteger(Number(results_per_page)))) {
      return response.status(400).json({ error: 'results_per_page must be a positive integer.' })
    }

    if (min_salary !== undefined && min_salary !== '' && (!Number.isFinite(Number(min_salary)) || Number(min_salary) < 0)) {
      return response.status(400).json({ error: 'min_salary must be a non-negative number.' })
    }

    const result = await jobDiscoveryService.searchUnified({
      keywords,
      location,
      work_mode,
      employment_type,
      min_salary: min_salary !== undefined && min_salary !== '' ? Number(min_salary) : null,
      source,
      country,
      sort,
      page: Number(page) || 1,
      results_per_page: Number(results_per_page) || 20,
      forceRefresh: force_refresh === 'true' || force_refresh === '1',
      user: request.user || null,
    })

    response.json(result)
  } catch (err) {
    if (err.message && (err.message.includes('Invalid') || err.message.includes('positive') || err.message.includes('exceed'))) {
      return response.status(400).json({ error: err.message })
    }
    response.status(500).json({ error: err.message || 'Failed to discover jobs.' })
  }
})

router.get('/:id', optionalAuth, async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid job ID.' })
  const result = request.user
    ? await pool.query(
      'SELECT * FROM jobs WHERE id = $1 AND (status = $2 OR created_by_user_id = $3)',
      [request.params.id, 'open', request.user.id],
    )
    : await pool.query('SELECT * FROM jobs WHERE id = $1 AND status = $2', [request.params.id, 'open'])
  if (!result.rowCount) return response.status(404).json({ error: 'Job not found.' })
  response.json(result.rows[0])
})

router.patch('/:id', requireAuth, requireEmployer, async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid job ID.' })
  const body = request.body ?? {}
  const validationError = validateJob(body, true)
  if (validationError) return response.status(400).json({ error: validationError })
  const fields = editableFields.filter((field) => body[field] !== undefined)
  if (!fields.length) return response.status(400).json({ error: 'Provide at least one job field to update.' })

  const values = fields.map((field) => {
    const value = body[field]
    return field === 'currency' ? value.toUpperCase() : typeof value === 'string' && textFields.includes(field) ? value.trim() : value
  })
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`)
  values.push(request.params.id)
  const result = await pool.query(
    `UPDATE jobs SET ${assignments.join(', ')}, updated_at = NOW()
    WHERE id = $${values.length} AND created_by_user_id = $${values.length + 1} RETURNING *`,
      [...values, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Job not found.' })
  response.json(result.rows[0])
})

router.delete('/:id', requireAuth, requireEmployer, async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid job ID.' })
  const result = await pool.query(
    'DELETE FROM jobs WHERE id = $1 AND created_by_user_id = $2 RETURNING id',
    [request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Job not found.' })
  response.status(204).end()
})

router.post('/:id/close', requireAuth, requireEmployer, async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid job ID.' })
  const result = await pool.query(
    `UPDATE jobs SET status = 'closed', updated_at = NOW()
     WHERE id = $1 AND created_by_user_id = $2
     RETURNING *`,
    [request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Job not found.' })
  response.json(result.rows[0])
})

router.post('/:id/reopen', requireAuth, requireEmployer, async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid job ID.' })
  const result = await pool.query(
    `UPDATE jobs SET status = 'open', updated_at = NOW()
     WHERE id = $1 AND created_by_user_id = $2
     RETURNING *`,
    [request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Job not found.' })
  response.json(result.rows[0])
})

export default router