import { Router } from 'express'
import { pool } from '../db.js'
import { isStringArray, isUuid } from '../lib/validation.js'
import { requireSameUser } from '../middleware/requireAuth.js'

const router = Router()
const arrayFields = ['target_roles', 'locations', 'employment_types', 'industries']
const remotePreferences = ['any', 'remote', 'hybrid', 'onsite']

function validatePreferences(body) {
  for (const field of arrayFields) {
    if (body[field] !== undefined && !isStringArray(body[field])) {
      return `${field} must be an array of strings.`
    }
  }
  if (body.remote_preference !== undefined && !remotePreferences.includes(body.remote_preference)) {
    return 'Invalid remote_preference.'
  }
  const minSalary = body.min_salary ?? null
  const maxSalary = body.max_salary ?? null
  if ([minSalary, maxSalary].some((value) => value !== null && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
    return 'Salary values must be non-negative numbers.'
  }
  if (minSalary !== null && maxSalary !== null && Number(minSalary) > Number(maxSalary)) {
    return 'min_salary cannot exceed max_salary.'
  }
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Za-z]{3}$/.test(body.currency))) {
    return 'currency must be a three-letter code.'
  }
  return null
}

function preferenceValues(userId, body) {
  return [
    userId,
    body.target_roles ?? [],
    body.locations ?? [],
    body.remote_preference ?? 'any',
    body.employment_types ?? [],
    body.industries ?? [],
    body.min_salary ?? null,
    body.max_salary ?? null,
    (body.currency ?? 'USD').toUpperCase(),
  ]
}

router.post('/', async (request, response) => {
  const body = request.body ?? {}
  const { user_id: userId } = body
  if (!isUuid(userId)) return response.status(400).json({ error: 'A valid user_id is required.' })
  if (!requireSameUser(request, response, userId)) return
  const validationError = validatePreferences(body)
  if (validationError) return response.status(400).json({ error: validationError })

  try {
    const result = await pool.query(
      `INSERT INTO job_preferences
        (user_id, target_roles, locations, remote_preference, employment_types, industries, min_salary, max_salary, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      preferenceValues(userId, body),
    )
    response.status(201).json(result.rows[0])
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'Preferences already exist for this user. Use PUT to update them.' })
    throw error
  }
})

router.get('/:userId', async (request, response) => {
  const { userId } = request.params
  if (!isUuid(userId)) return response.status(400).json({ error: 'Invalid user ID.' })
  if (!requireSameUser(request, response, userId)) return
  const result = await pool.query('SELECT * FROM job_preferences WHERE user_id = $1 AND user_id = $2', [userId, request.user.id])
  if (!result.rowCount) return response.status(404).json({ error: 'Job preferences not found.' })
  response.json(result.rows[0])
})

router.put('/:userId', async (request, response) => {
  const { userId } = request.params
  if (!isUuid(userId)) return response.status(400).json({ error: 'Invalid user ID.' })
  if (!requireSameUser(request, response, userId)) return
  const body = request.body ?? {}
  const validationError = validatePreferences(body)
  if (validationError) return response.status(400).json({ error: validationError })

  const result = await pool.query(
    `INSERT INTO job_preferences
      (user_id, target_roles, locations, remote_preference, employment_types, industries, min_salary, max_salary, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id) DO UPDATE SET
      target_roles = EXCLUDED.target_roles,
      locations = EXCLUDED.locations,
      remote_preference = EXCLUDED.remote_preference,
      employment_types = EXCLUDED.employment_types,
      industries = EXCLUDED.industries,
      min_salary = EXCLUDED.min_salary,
      max_salary = EXCLUDED.max_salary,
      currency = EXCLUDED.currency,
      updated_at = NOW()
     RETURNING *`,
    preferenceValues(userId, body),
  )
  response.json(result.rows[0])
})

export default router