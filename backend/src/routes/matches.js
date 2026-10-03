import { Router } from 'express'
import { pool } from '../db.js'
import { isUuid } from '../lib/validation.js'
import { requireSameUser } from '../middleware/requireAuth.js'
import { scoreJob } from '../services/matchJobs.js'

const router = Router()
const matchStatuses = ['new', 'saved', 'dismissed', 'applied']

router.get('/', async (request, response) => {
  const { user_id: userId, status } = request.query
  if (!isUuid(userId)) return response.status(400).json({ error: 'A valid user_id query parameter is required.' })
  if (!requireSameUser(request, response, userId)) return
  if (status && !matchStatuses.includes(status)) return response.status(400).json({ error: 'Invalid match status.' })
  const values = [request.user.id]
  const statusFilter = status ? 'AND m.status = $2' : ''
  if (status) values.push(status)
  const result = await pool.query(
    `SELECT m.id, m.user_id, m.job_id, m.score, m.score_breakdown, m.status, m.matched_at,
      j.company, j.title, j.location, j.remote_type, j.employment_type, j.source_url, j.salary_min, j.salary_max
     FROM job_matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.user_id = $1 ${statusFilter}
     ORDER BY m.score DESC, m.matched_at DESC`,
    values,
  )
  response.json(result.rows)
})

router.post('/refresh', async (request, response) => {
  const { user_id: userId } = request.body ?? {}
  if (!isUuid(userId)) return response.status(400).json({ error: 'A valid user_id is required.' })
  if (!requireSameUser(request, response, userId)) return
  const user = await pool.query('SELECT id FROM users WHERE id = $1', [request.user.id])
  if (!user.rowCount) return response.status(404).json({ error: 'User not found.' })

  const [preferencesResult, jobsResult] = await Promise.all([
    pool.query('SELECT * FROM job_preferences WHERE user_id = $1', [request.user.id]),
    pool.query(
      `SELECT * FROM jobs
       WHERE status = 'open' AND (created_by_user_id IS NULL OR created_by_user_id = $1)
       ORDER BY created_at DESC`,
      [request.user.id],
    ),
  ])
  const preferences = preferencesResult.rows[0] ?? {}

  for (const job of jobsResult.rows) {
    const match = scoreJob(job, preferences)
    await pool.query(
      `INSERT INTO job_matches (user_id, job_id, score, score_breakdown)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, job_id) DO UPDATE SET
        score = EXCLUDED.score,
        score_breakdown = EXCLUDED.score_breakdown,
        matched_at = NOW(),
        updated_at = NOW()
       WHERE job_matches.status = 'new'`,
      [request.user.id, job.id, match.score, JSON.stringify(match.score_breakdown)],
    )
  }

  response.json({ user_id: userId, evaluated_jobs: jobsResult.rowCount })
})

router.patch('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid match ID.' })
  const { user_id: userId, status } = request.body ?? {}
  if (!isUuid(userId)) return response.status(400).json({ error: 'A valid user_id is required.' })
  if (!requireSameUser(request, response, userId)) return
  if (!matchStatuses.includes(status)) return response.status(400).json({ error: 'Invalid match status.' })
  const result = await pool.query(
    `UPDATE job_matches SET status = $1, updated_at = NOW()
    WHERE id = $2 AND user_id = $3 RETURNING *`,
      [status, request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Match not found.' })
  response.json(result.rows[0])
})

export default router