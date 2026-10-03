import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { pool } from '../db.js'
import { sessionCookieName } from '../auth/secrets.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { isOtpDeliveryAvailable, deliverOtp } from '../services/otpDelivery.js'
import { generateOtp, hashOtp, otpLifetimeMinutes, otpMaximumAttempts, verifyOtpHash } from '../services/otp.js'

const emailPattern = /^\S+@\S+\.\S+$/
const genericOtpResponse = { message: 'If this address can receive a sign-in code, one has been sent.' }

function validEmail(email) {
  return typeof email === 'string' && emailPattern.test(email.trim())
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve())
  })
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve())
  })
}

export function createAuthRouter({ sendOtp = deliverOtp, canDeliverOtp = isOtpDeliveryAvailable } = {}) {
  const router = Router()
  const requestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false })
  const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false })

  router.post('/otp/request', requestLimiter, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!validEmail(email)) return response.status(400).json({ error: 'A valid email address is required.' })
  if (!canDeliverOtp()) return response.status(503).json({ error: 'OTP delivery is not configured.' })

  const code = generateOtp()
  const client = await pool.connect()
  let challengeId
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE otp_challenges SET consumed_at = NOW()
       WHERE email = $1 AND consumed_at IS NULL`,
      [email],
    )
    await client.query("DELETE FROM otp_challenges WHERE created_at < NOW() - INTERVAL '7 days'")
    const result = await client.query(
      `INSERT INTO otp_challenges (email, code_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'))
       RETURNING id`,
      [email, hashOtp(email, code), otpLifetimeMinutes],
    )
    challengeId = result.rows[0].id
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  try {
    await sendOtp({ email, code })
  } catch (error) {
    await pool.query('UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1', [challengeId])
    if (error.code === 'OTP_DELIVERY_NOT_CONFIGURED') {
      return response.status(503).json({ error: 'OTP delivery is not configured.' })
    }
    throw error
  }
  response.status(202).json(genericOtpResponse)
  })

  router.post('/otp/verify', verifyLimiter, async (request, response, next) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const { code, full_name: fullName } = request.body ?? {}
  if (!validEmail(email) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ error: 'A valid email and six-digit code are required.' })
  }
  if (fullName !== undefined && (typeof fullName !== 'string' || !fullName.trim())) {
    return response.status(400).json({ error: 'full_name must be non-empty text when provided.' })
  }

  const client = await pool.connect()
  let user
  let verified = false
  try {
    await client.query('BEGIN')
    const challengeResult = await client.query(
      `SELECT id, code_hash, expires_at, attempt_count
       FROM otp_challenges
       WHERE email = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1 FOR UPDATE`,
      [email],
    )
    const challenge = challengeResult.rows[0]
    if (challenge && challenge.attempt_count >= otpMaximumAttempts) {
      await client.query('UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1', [challenge.id])
    } else if (challenge) {
      const expired = new Date(challenge.expires_at).getTime() <= Date.now()
      if (expired) {
        await client.query('UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1', [challenge.id])
      } else if (!verifyOtpHash(email, code, challenge.code_hash.trim())) {
        const attempts = challenge.attempt_count + 1
        await client.query(
          `UPDATE otp_challenges
           SET attempt_count = $1,
               consumed_at = CASE WHEN $2 THEN NOW() ELSE consumed_at END
           WHERE id = $3`,
          [attempts, attempts >= otpMaximumAttempts, challenge.id],
        )
      } else {
        const currentUser = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email])
        if (!currentUser.rowCount && typeof fullName !== 'string') {
          await client.query('COMMIT')
          return response.status(400).json({ error: 'full_name is required for a new account.' })
        }
        await client.query('UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1', [challenge.id])
        const userResult = currentUser.rowCount
          ? await client.query(
            `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
             WHERE id = $1
             RETURNING id, email, full_name, role, email_verified_at, avatar_storage_key`,
            [currentUser.rows[0].id],
          )
          : await client.query(
            `INSERT INTO users (email, full_name, email_verified_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (email) DO UPDATE SET
              email_verified_at = COALESCE(users.email_verified_at, NOW()),
              updated_at = NOW()
             RETURNING id, email, full_name, role, email_verified_at, avatar_storage_key`,
            [email, fullName.trim()],
          )
        user = userResult.rows[0]
        verified = true
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }

  if (!verified) return response.status(401).json({ error: 'The sign-in code is invalid or expired.' })
  try {
    await regenerateSession(request)
    request.session.userId = user.id
    await saveSession(request)
  } catch (error) {
    return next(error)
  }
  response.json({ user })
  })

  router.post('/logout', (request, response, next) => {
  if (!request.session) return response.status(204).end()
  request.session.destroy((error) => {
    if (error) return next(error)
    response.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
    response.status(204).end()
  })
  })

  router.get('/me', requireAuth, (request, response) => {
    response.json({ user: request.user })
  })

  return router
}

export default createAuthRouter()