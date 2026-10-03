import { pool } from '../db.js'
import { isUuid } from '../lib/validation.js'

async function loadUser(request, userId) {
  if (!isUuid(userId)) return null
  const result = await pool.query(
    `SELECT id, email, full_name, role, email_verified_at, avatar_storage_key
     FROM users WHERE id = $1 AND email_verified_at IS NOT NULL`,
    [userId],
  )
  return result.rows[0] ?? null
}

export async function optionalAuth(request, _response, next) {
  const userId = request.session?.userId
  if (!isUuid(userId)) return next()
  try {
    request.user = await loadUser(request, userId)
    if (!request.user) request.session.destroy(() => {})
    next()
  } catch (error) {
    next(error)
  }
}

export async function requireAuth(request, response, next) {
  const userId = request.session?.userId
  if (!isUuid(userId)) return response.status(401).json({ error: 'Authentication required.' })

  try {
    request.user = await loadUser(request, userId)
    if (!request.user) {
      request.session.destroy(() => {})
      return response.status(401).json({ error: 'Authentication required.' })
    }
    next()
  } catch (error) {
    next(error)
  }
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    if (!request.user) {
      return response.status(401).json({ error: 'Authentication required.' })
    }
    const userRole = request.user.role || 'job_seeker'
    if (!allowedRoles.includes(userRole)) {
      return response.status(403).json({ error: 'Access denied. Required role not granted.' })
    }
    next()
  }
}

export const requireEmployer = requireRole('employer', 'recruiter')

export function requireSameUser(request, response, requestedUserId) {
  if (requestedUserId && requestedUserId !== request.user.id) {
    response.status(403).json({ error: "You cannot access another user's data." })
    return false
  }
  return true
}