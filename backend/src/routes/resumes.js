import { Router } from 'express'
import multer from 'multer'
import { pool } from '../db.js'
import { isUuid } from '../lib/validation.js'
import { requireSameUser } from '../middleware/requireAuth.js'
import { deleteResumeFile, readResumeFile, storeResumeFile } from '../services/resumeStorage.js'
import { maximumResumeBytes, validateResumeUpload } from '../services/resumeValidation.js'

const router = Router()
const resumeFields = ['title', 'source_filename', 'mime_type', 'content_text', 'file_size_bytes', 'is_primary']
const resumeSelection = 'id, user_id, title, source_filename, mime_type, content_text, file_size_bytes, storage_key, is_primary, created_at, updated_at'
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumResumeBytes, files: 1, fields: 3, parts: 4 },
})

function resumeResponse(row) {
  return { ...row, file_url: row.storage_key ? `/api/resumes/${row.id}/file` : null }
}

function validateResume(body, partial = false) {
  if ((!partial || body.title !== undefined) && (typeof body.title !== 'string' || !body.title.trim())) {
    return 'title is required.'
  }
  for (const field of ['source_filename', 'mime_type', 'content_text']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      return `${field} must be text.`
    }
  }
  if (body.file_size_bytes !== undefined && body.file_size_bytes !== null
    && (!Number.isInteger(Number(body.file_size_bytes)) || Number(body.file_size_bytes) < 0)) {
    return 'file_size_bytes must be a non-negative integer.'
  }
  if (body.is_primary !== undefined && typeof body.is_primary !== 'boolean') return 'is_primary must be a boolean.'
  return null
}

router.get('/me', async (request, response) => {
  const result = await pool.query(
    `SELECT ${resumeSelection} FROM resumes WHERE user_id = $1
     ORDER BY is_primary DESC, updated_at DESC LIMIT 1`,
    [request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Resume not found.' })
  response.json(resumeResponse(result.rows[0]))
})

router.get('/', async (request, response) => {
  const { user_id: userId } = request.query
  if (!isUuid(userId)) return response.status(400).json({ error: 'A valid user_id query parameter is required.' })
  if (!requireSameUser(request, response, userId)) return
  const result = await pool.query(
    `SELECT ${resumeSelection} FROM resumes
     WHERE user_id = $1 AND user_id = $2 ORDER BY is_primary DESC, updated_at DESC`,
    [userId, request.user.id],
  )
  response.json(result.rows.map(resumeResponse))
})

router.get('/:id/file', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid resume ID.' })
  const result = await pool.query(
    `SELECT storage_key, source_filename, mime_type FROM resumes
     WHERE id = $1 AND user_id = $2`,
    [request.params.id, request.user.id],
  )
  if (!result.rowCount || !result.rows[0].storage_key) {
    return response.status(404).json({ error: 'Resume file not found.' })
  }
  const resume = result.rows[0]
  const file = await readResumeFile(request.user.id, resume.storage_key)
  if (!file) return response.status(404).json({ error: 'Resume file not found.' })
  response
    .type(resume.mime_type)
    .attachment(resume.source_filename || 'resume')
    .set('Cache-Control', 'private, no-store')
    .set('X-Content-Type-Options', 'nosniff')
    .send(file)
})

router.get('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid resume ID.' })
  const result = await pool.query(
    `SELECT ${resumeSelection} FROM resumes WHERE id = $1 AND user_id = $2`,
    [request.params.id, request.user.id],
  )
  if (!result.rowCount) return response.status(404).json({ error: 'Resume not found.' })
  response.json(resumeResponse(result.rows[0]))
})

router.post('/upload', resumeUpload.single('file'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ error: 'Provide a resume file in the file field.' })
  const body = request.body ?? {}
  if (body.user_id !== undefined && !isUuid(body.user_id)) {
    return response.status(400).json({ error: 'Invalid user_id.' })
  }
  if (!requireSameUser(request, response, body.user_id)) return
  if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
    return response.status(400).json({ error: 'title must be non-empty text.' })
  }
  const primaryValue = body.is_primary
  if (primaryValue !== undefined && ![true, false, 'true', 'false'].includes(primaryValue)) {
    return response.status(400).json({ error: 'is_primary must be true or false.' })
  }

  let fileMetadata
  try {
    fileMetadata = await validateResumeUpload(request.file)
  } catch (error) {
    return next(error)
  }
  const title = (body.title?.trim() || fileMetadata.sourceFilename.replace(/\.[^.]+$/, '') || 'Resume').slice(0, 160)
  const isPrimary = primaryValue === true || primaryValue === 'true'
  let storageKey
  let client
  let createdResume
  try {
    storageKey = await storeResumeFile(request.user.id, fileMetadata.extension, request.file.buffer)
    client = await pool.connect()
    await client.query('BEGIN')
    if (isPrimary) await client.query('UPDATE resumes SET is_primary = FALSE WHERE user_id = $1', [request.user.id])
    const result = await client.query(
      `INSERT INTO resumes
        (user_id, title, source_filename, mime_type, content_text, file_size_bytes, storage_key, is_primary)
       VALUES ($1, $2, $3, $4, '', $5, $6, $7)
       RETURNING ${resumeSelection}`,
      [request.user.id, title, fileMetadata.sourceFilename, fileMetadata.mimeType, request.file.size, storageKey, isPrimary],
    )
    createdResume = result.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    if (storageKey) await deleteResumeFile(request.user.id, storageKey).catch(() => {})
    return next(error)
  } finally {
    client?.release()
  }
  response.status(201).json(resumeResponse(createdResume))
})

router.post('/', async (request, response) => {
  const body = request.body ?? {}
  if (!isUuid(body.user_id)) return response.status(400).json({ error: 'A valid user_id is required.' })
  if (!requireSameUser(request, response, body.user_id)) return
  const validationError = validateResume(body)
  if (validationError) return response.status(400).json({ error: validationError })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (body.is_primary) await client.query('UPDATE resumes SET is_primary = FALSE WHERE user_id = $1', [body.user_id])
    const result = await client.query(
      `INSERT INTO resumes
        (user_id, title, source_filename, mime_type, content_text, file_size_bytes, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, title, source_filename, mime_type, content_text, file_size_bytes, is_primary, created_at, updated_at`,
      [
        body.user_id,
        body.title.trim(),
        body.source_filename ?? null,
        body.mime_type ?? 'text/plain',
        body.content_text ?? '',
        body.file_size_bytes ?? null,
        body.is_primary ?? false,
      ],
    )
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

router.put('/:id/file', resumeUpload.single('file'), async (request, response, next) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid resume ID.' })
  if (!request.file) return response.status(400).json({ error: 'Provide a replacement file in the file field.' })
  let fileMetadata
  try {
    fileMetadata = await validateResumeUpload(request.file)
  } catch (error) {
    return next(error)
  }

  let storageKey
  let oldStorageKey
  let client
  let updatedResume
  try {
    storageKey = await storeResumeFile(request.user.id, fileMetadata.extension, request.file.buffer)
    client = await pool.connect()
    await client.query('BEGIN')
    const current = await client.query(
      'SELECT storage_key FROM resumes WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [request.params.id, request.user.id],
    )
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      await deleteResumeFile(request.user.id, storageKey)
      return response.status(404).json({ error: 'Resume not found.' })
    }
    oldStorageKey = current.rows[0].storage_key
    const result = await client.query(
      `UPDATE resumes
       SET source_filename = $1, mime_type = $2, content_text = '', file_size_bytes = $3,
           storage_key = $4, updated_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING ${resumeSelection}`,
      [fileMetadata.sourceFilename, fileMetadata.mimeType, request.file.size, storageKey, request.params.id, request.user.id],
    )
    updatedResume = result.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {})
    if (storageKey) await deleteResumeFile(request.user.id, storageKey).catch(() => {})
    return next(error)
  } finally {
    client?.release()
  }
  if (oldStorageKey) {
    await deleteResumeFile(request.user.id, oldStorageKey).catch((error) => {
      console.warn('Could not remove replaced resume file:', error.code ?? 'storage error')
    })
  }
  response.json(resumeResponse(updatedResume))
})

router.patch('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid resume ID.' })
  const body = request.body ?? {}
  const validationError = validateResume(body, true)
  if (validationError) return response.status(400).json({ error: validationError })
  const fields = resumeFields.filter((field) => body[field] !== undefined)
  if (!fields.length) return response.status(400).json({ error: 'Provide at least one resume field to update.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      'SELECT user_id FROM resumes WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [request.params.id, request.user.id],
    )
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Resume not found.' })
    }
    if (body.is_primary === true) {
      await client.query('UPDATE resumes SET is_primary = FALSE WHERE user_id = $1', [current.rows[0].user_id])
    }
    const values = fields.map((field) => body[field])
    const assignments = fields.map((field, index) => `${field} = $${index + 1}`)
    values.push(request.params.id, request.user.id)
    const result = await client.query(
      `UPDATE resumes SET ${assignments.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING id, user_id, title, source_filename, mime_type, content_text, file_size_bytes, is_primary, created_at, updated_at`,
      values,
    )
    await client.query('COMMIT')
    response.json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

router.delete('/:id', async (request, response) => {
  if (!isUuid(request.params.id)) return response.status(400).json({ error: 'Invalid resume ID.' })
  let storageKey
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      'SELECT storage_key FROM resumes WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [request.params.id, request.user.id],
    )
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Resume not found.' })
    }
    storageKey = current.rows[0].storage_key
    await client.query('DELETE FROM resumes WHERE id = $1 AND user_id = $2', [request.params.id, request.user.id])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
  if (storageKey) {
    await deleteResumeFile(request.user.id, storageKey).catch((error) => {
      console.warn('Could not remove deleted resume file:', error.code ?? 'storage error')
    })
  }
  response.status(204).end()
})
export default router