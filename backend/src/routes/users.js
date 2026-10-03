import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { pool } from '../db.js'
import { isOptionalString, isUuid } from '../lib/validation.js'
import { requireSameUser } from '../middleware/requireAuth.js'
import { deleteProfileImage, readProfileImage, storeProfileImage } from '../services/profileImageStorage.js'

const router = Router()
const maximumImageBytes = 5 * 1024 * 1024
const maximumImagePixels = 20_000_000
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumImageBytes, files: 1, fields: 0, parts: 1 },
})

function profileResponse(user) {
  return {
    ...user,
    profile_image_url: user.avatar_storage_key ? '/api/users/me/avatar' : null,
  }
}

async function normalizeProfileImage(buffer) {
  try {
    const image = sharp(buffer, { limitInputPixels: maximumImagePixels, failOn: 'error' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)
      || !metadata.width || !metadata.height
      || metadata.width * metadata.height > maximumImagePixels) {
      throw new Error('Unsupported profile image.')
    }
    const normalized = await image.rotate().webp({ quality: 86, effort: 4 }).toBuffer()
    if (normalized.length > maximumImageBytes) {
      throw Object.assign(new Error('Normalized image exceeds the upload limit.'), { code: 'IMAGE_TOO_LARGE' })
    }
    return normalized
  } catch (error) {
    if (error.code === 'IMAGE_TOO_LARGE') throw error
    throw Object.assign(new Error('Upload a valid JPEG, PNG, or WebP image.'), { code: 'INVALID_IMAGE' })
  }
}

router.post('/', async (request, response) => {
  const { email, full_name } = request.body ?? {}
  if (email !== undefined && (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim()))) {
    return response.status(400).json({ error: 'A valid email address is required.' })
  }
  if (email && email.trim().toLowerCase() !== request.user.email) {
    return response.status(403).json({ error: 'You cannot create or edit another user.' })
  }
  if (full_name !== undefined && (typeof full_name !== 'string' || !full_name.trim())) {
    return response.status(400).json({ error: 'Full name must be non-empty text.' })
  }
  if (full_name && full_name.trim() !== request.user.full_name) {
    const result = await pool.query(
      `UPDATE users SET full_name = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, full_name, email_verified_at, avatar_storage_key, created_at, updated_at`,
      [full_name.trim(), request.user.id],
    )
    return response.json(result.rows[0])
  }
  response.json(request.user)
})

router.get('/me', async (request, response) => {
  const result = await pool.query(
    `SELECT id, email, full_name, email_verified_at, avatar_storage_key, created_at, updated_at
     FROM users WHERE id = $1`,
    [request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'User not found.' })
  response.json(profileResponse(result.rows[0]))
})

router.patch('/me', async (request, response) => {
  const { email, full_name: fullName } = request.body ?? {}
  if (!isOptionalString(email) || !isOptionalString(fullName)) {
    return response.status(400).json({ error: 'Email and full_name must be text.' })
  }
  if (email !== undefined && email.trim().toLowerCase() !== request.user.email) {
    return response.status(400).json({ error: 'Email changes require a separate verification flow.' })
  }
  if (fullName !== undefined && !fullName.trim()) {
    return response.status(400).json({ error: 'full_name cannot be empty.' })
  }
  if (fullName === undefined) return response.status(400).json({ error: 'Provide full_name to update.' })

  const result = await pool.query(
    `UPDATE users SET full_name = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, email, full_name, email_verified_at, avatar_storage_key, created_at, updated_at`,
    [fullName.trim(), request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'User not found.' })
  response.json(profileResponse(result.rows[0]))
})

router.post('/me/avatar', upload.single('image'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ error: 'Provide an image file in the image field.' })
  let normalizedImage
  try {
    normalizedImage = await normalizeProfileImage(request.file.buffer)
  } catch (error) {
    return next(error)
  }

  let storageKey
  let client
  let oldStorageKey
  let updatedUser
  try {
    storageKey = await storeProfileImage(request.user.id, normalizedImage)
    client = await pool.connect()
    await client.query('BEGIN')
    const current = await client.query(
      'SELECT avatar_storage_key FROM users WHERE id = $1 FOR UPDATE',
      [request.user.id],
    )
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      await deleteProfileImage(request.user.id, storageKey)
      return response.status(404).json({ error: 'User not found.' })
    }
    oldStorageKey = current.rows[0].avatar_storage_key
    const result = await client.query(
      `UPDATE users SET avatar_storage_key = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, full_name, email_verified_at, avatar_storage_key, created_at, updated_at`,
      [storageKey, request.user.id],
    )
    updatedUser = result.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    if (storageKey) await deleteProfileImage(request.user.id, storageKey).catch(() => {})
    return next(error)
  } finally {
    client?.release()
  }

  if (oldStorageKey) {
    await deleteProfileImage(request.user.id, oldStorageKey).catch((error) => {
      console.warn('Could not remove replaced profile image:', error.code ?? 'storage error')
    })
  }
  response.json(profileResponse(updatedUser))
})

router.get('/me/avatar', async (request, response) => {
  const storageKey = request.user.avatar_storage_key
  if (!storageKey) return response.status(404).json({ error: 'Profile image not found.' })
  const image = await readProfileImage(request.user.id, storageKey)
  if (!image) return response.status(404).json({ error: 'Profile image not found.' })
  response
    .type('image/webp')
    .set('Cache-Control', 'private, max-age=60')
    .set('X-Content-Type-Options', 'nosniff')
    .send(image)
})

router.delete('/me/avatar', async (request, response) => {
  const client = await pool.connect()
  let storageKey
  let updatedUser
  try {
    await client.query('BEGIN')
    const current = await client.query(
      'SELECT avatar_storage_key FROM users WHERE id = $1 FOR UPDATE',
      [request.user.id],
    )
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'User not found.' })
    }
    storageKey = current.rows[0].avatar_storage_key
    const result = await client.query(
      `UPDATE users SET avatar_storage_key = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, full_name, email_verified_at, avatar_storage_key, created_at, updated_at`,
      [request.user.id],
    )
    updatedUser = result.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  if (storageKey) {
    await deleteProfileImage(request.user.id, storageKey).catch((error) => {
      console.warn('Could not remove profile image:', error.code ?? 'storage error')
    })
  }
  response.json(profileResponse(updatedUser))
})

router.get('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid user ID.' })
  if (!requireSameUser(request, response, request.params.id)) return
  const result = await pool.query(
    'SELECT id, email, full_name, email_verified_at, avatar_storage_key, created_at, updated_at FROM users WHERE id = $1 AND id = $2',
    [request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'User not found.' })
  response.json(result.rows[0])
})

router.patch('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid user ID.' })
  if (!requireSameUser(request, response, request.params.id)) return
  const { email, full_name } = request.body ?? {}
  if (!isOptionalString(email) || !isOptionalString(full_name)) {
    return response.status(400).json({ error: 'Email and full name must be text.' })
  }
  if (email !== undefined && !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return response.status(400).json({ error: 'A valid email address is required.' })
  }
  if (email !== undefined && email.trim().toLowerCase() !== request.user.email) {
    return response.status(400).json({ error: 'Email changes require a separate verification flow.' })
  }
  if (full_name !== undefined && !full_name.trim()) {
    return response.status(400).json({ error: 'Full name cannot be empty.' })
  }

  const fields = []
  const values = []
  if (full_name !== undefined) {
    values.push(full_name.trim())
    fields.push(`full_name = $${values.length}`)
  }
  if (!fields.length) return response.status(400).json({ error: 'Provide email or full_name to update.' })

  try {
    values.push(request.params.id)
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length} AND id = $${values.length + 1}
       RETURNING id, email, full_name, created_at, updated_at`,
          [...values, request.user.id],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'User not found.' })
    response.json(result.rows[0])
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'That email is already registered.' })
    throw error
  }
})

export default router