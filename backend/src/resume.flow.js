import assert from 'node:assert/strict'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import yazl from 'yazl'
import { createApp } from './app.js'
import { databaseConfigured, pool } from './db.js'
import { resumeStorageRoot, deleteResumeFile, readResumeFile } from './services/resumeStorage.js'

if (!databaseConfigured) throw new Error('DATABASE_URL is required for the resume integration flow.')

const suffix = Date.now()
const identities = [
  { email: `resume-flow-a-${suffix}@example.invalid`, fullName: 'Temporary Resume Owner' },
  { email: `resume-flow-b-${suffix}@example.invalid`, fullName: 'Temporary Resume Other User' },
]
const deliveredCodes = new Map()
const userIds = []
let server
let result

async function request(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const headers = {}
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })
}

async function signIn(baseUrl, identity) {
  const otpResponse = await request(baseUrl, '/api/auth/otp/request', {
    method: 'POST',
    body: { email: identity.email },
  })
  assert.equal(otpResponse.status, 202)
  const verifyResponse = await request(baseUrl, '/api/auth/otp/verify', {
    method: 'POST',
    body: { email: identity.email, code: deliveredCodes.get(identity.email), full_name: identity.fullName },
  })
  assert.equal(verifyResponse.status, 200)
  const { user } = await verifyResponse.json()
  userIds.push(user.id)
  return { user, cookie: verifyResponse.headers.get('set-cookie').split(';', 1)[0] }
}

function createDocxBuffer() {
  return new Promise((resolveBuffer, reject) => {
    const zip = new yazl.ZipFile()
    const chunks = []
    zip.outputStream.on('data', (chunk) => chunks.push(chunk))
    zip.outputStream.on('error', reject)
    zip.outputStream.on('end', () => resolveBuffer(Buffer.concat(chunks)))
    zip.addBuffer(Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), '[Content_Types].xml')
    zip.addBuffer(Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'), 'word/document.xml')
    zip.end()
  })
}

function resumeForm({ bytes, filename, mimeType, userId, title, isPrimary }) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mimeType }), filename)
  if (userId) form.append('user_id', userId)
  if (title) form.append('title', title)
  if (isPrimary !== undefined) form.append('is_primary', String(isPrimary))
  return form
}

try {
  const app = createApp({
    canDeliverOtp: () => true,
    sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
  })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  assert.equal((await request(baseUrl, '/api/resumes/me')).status, 401)

  const owner = await signIn(baseUrl, identities[0])
  const other = await signIn(baseUrl, identities[1])
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
  const createResponse = await request(baseUrl, '/api/resumes/upload', {
    method: 'POST',
    cookie: owner.cookie,
    body: resumeForm({ bytes: pdf, filename: 'owner-resume.pdf', mimeType: 'application/pdf', userId: owner.user.id, isPrimary: true }),
  })
  assert.equal(createResponse.status, 201)
  const created = await createResponse.json()
  assert.equal(created.mime_type, 'application/pdf')
  assert.equal(created.content_text, '')
  assert.equal(created.is_primary, true)
  assert.equal(Number(created.file_size_bytes), pdf.length)
  assert.match(created.storage_key, new RegExp(`^${owner.user.id}/[0-9a-f-]{36}\\.pdf$`))

  const storedMetadata = await pool.query(
    'SELECT storage_key, content_text FROM resumes WHERE id = $1 AND user_id = $2',
    [created.id, owner.user.id],
  )
  assert.equal(storedMetadata.rowCount, 1)
  assert.equal(storedMetadata.rows[0].storage_key, created.storage_key)
  assert.equal(storedMetadata.rows[0].content_text, '')

  const currentResponse = await request(baseUrl, '/api/resumes/me', { cookie: owner.cookie })
  assert.equal(currentResponse.status, 200)
  assert.equal((await currentResponse.json()).id, created.id)
  assert.equal((await request(baseUrl, `/api/resumes/${created.id}`, { cookie: other.cookie })).status, 404)
  assert.equal((await request(baseUrl, `/api/resumes/${created.id}/file`, { cookie: other.cookie })).status, 404)

  const pdfDownload = await request(baseUrl, `/api/resumes/${created.id}/file`, { cookie: owner.cookie })
  assert.equal(pdfDownload.status, 200)
  assert.match(pdfDownload.headers.get('content-disposition'), /attachment/)
  assert.deepEqual(Buffer.from(await pdfDownload.arrayBuffer()), pdf)

  const invalidUpload = await request(baseUrl, '/api/resumes/upload', {
    method: 'POST',
    cookie: owner.cookie,
    body: resumeForm({ bytes: Buffer.from('not a PDF'), filename: 'fake.pdf', mimeType: 'application/pdf' }),
  })
  assert.equal(invalidUpload.status, 415)

  const docx = await createDocxBuffer()
  const replaceResponse = await request(baseUrl, `/api/resumes/${created.id}/file`, {
    method: 'PUT',
    cookie: owner.cookie,
    body: resumeForm({ bytes: docx, filename: 'updated-resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  })
  assert.equal(replaceResponse.status, 200)
  const replaced = await replaceResponse.json()
  assert.equal(replaced.mime_type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.notEqual(replaced.storage_key, created.storage_key)
  assert.equal(await readResumeFile(owner.user.id, created.storage_key), null)

  const docxDownload = await request(baseUrl, `/api/resumes/${created.id}/file`, { cookie: owner.cookie })
  assert.equal(docxDownload.status, 200)
  assert.deepEqual(Buffer.from(await docxDownload.arrayBuffer()), docx)

  const deleteResponse = await request(baseUrl, `/api/resumes/${created.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  })
  assert.equal(deleteResponse.status, 204)
  assert.equal(await readResumeFile(owner.user.id, replaced.storage_key), null)
  assert.equal((await request(baseUrl, `/api/resumes/${created.id}`, { cookie: owner.cookie })).status, 404)

  const legacyResponse = await request(baseUrl, '/api/resumes', {
    method: 'POST',
    cookie: owner.cookie,
    body: { user_id: owner.user.id, title: 'Legacy text resume', content_text: 'Existing JSON contract remains supported.' },
  })
  assert.equal(legacyResponse.status, 201)
  const legacyResume = await legacyResponse.json()
  assert.equal(legacyResume.content_text, 'Existing JSON contract remains supported.')
  assert.equal((await request(baseUrl, `/api/resumes/${legacyResume.id}`, { cookie: owner.cookie })).status, 200)
  assert.equal((await request(baseUrl, `/api/resumes/${legacyResume.id}`, { cookie: other.cookie })).status, 404)
  await request(baseUrl, `/api/resumes/${legacyResume.id}`, { method: 'DELETE', cookie: owner.cookie })

  result = { pdfUpload: 201, currentResume: 200, pdfDownload: 200, docxReplace: 200, docxDownload: 200, delete: 204, legacyJsonContract: 'passed', crossUserDenied: 'passed' }
} catch (error) {
  console.error(JSON.stringify({ resumeIntegration: 'failed', message: error.message }))
  process.exitCode = 1
} finally {
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolveServer) => server.close(resolveServer))
  }
  try {
    const emails = identities.map((identity) => identity.email)
    const users = await pool.query('SELECT id FROM users WHERE email = ANY($1::text[])', [emails])
    const ids = [...new Set([...userIds, ...users.rows.map((user) => user.id)])]
    const resumes = await pool.query(
      'SELECT user_id, storage_key FROM resumes WHERE user_id = ANY($1::uuid[])',
      [ids],
    )
    for (const resume of resumes.rows) {
      if (resume.storage_key) await deleteResumeFile(resume.user_id, resume.storage_key)
    }
    await pool.query('DELETE FROM resumes WHERE user_id = ANY($1::uuid[])', [ids])
    await pool.query("DELETE FROM user_sessions WHERE sess ->> $1 = ANY($2::text[])", ['userId', ids])
    await pool.query('DELETE FROM otp_challenges WHERE email = ANY($1::text[])', [emails])
    for (const id of ids) await rm(resolve(resumeStorageRoot, id), { recursive: true, force: true })
    const cleanup = await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[]) RETURNING id', [ids])
    console.log(JSON.stringify({ ...result, temporaryUsersRemoved: cleanup.rowCount }))
  } catch (error) {
    console.error(JSON.stringify({ cleanup: 'failed', code: error.code ?? null }))
    process.exitCode = 1
  }
  await pool.end()
}