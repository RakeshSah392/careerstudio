import assert from 'node:assert/strict'
import { once } from 'node:events'
import sharp from 'sharp'
import { createApp } from './app.js'
import { databaseConfigured, pool } from './db.js'
import { deleteProfileImage, readProfileImage } from './services/profileImageStorage.js'

if (!databaseConfigured) throw new Error('DATABASE_URL is required for the profile integration flow.')

const suffix = Date.now()
const identities = [
  { email: `profile-flow-a-${suffix}@example.invalid`, fullName: 'Temporary Profile Owner' },
  { email: `profile-flow-b-${suffix}@example.invalid`, fullName: 'Temporary Other User' },
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
  const requested = await request(baseUrl, '/api/auth/otp/request', {
    method: 'POST',
    body: { email: identity.email },
  })
  assert.equal(requested.status, 202)
  const verified = await request(baseUrl, '/api/auth/otp/verify', {
    method: 'POST',
    body: { email: identity.email, code: deliveredCodes.get(identity.email), full_name: identity.fullName },
  })
  assert.equal(verified.status, 200)
  const { user } = await verified.json()
  userIds.push(user.id)
  return { user, cookie: verified.headers.get('set-cookie').split(';', 1)[0] }
}

async function uploadImage(baseUrl, cookie, bytes, filename, mimeType) {
  const form = new FormData()
  form.set('image', new Blob([bytes], { type: mimeType }), filename)
  return request(baseUrl, '/api/users/me/avatar', { method: 'POST', cookie, body: form })
}

try {
  const app = createApp({
    canDeliverOtp: () => true,
    sendOtp: async ({ email, code }) => deliveredCodes.set(email, code),
  })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  assert.equal((await request(baseUrl, '/api/users/me')).status, 401)
  assert.equal((await uploadImage(baseUrl, '', Buffer.from('unauthenticated'), 'x.png', 'image/png')).status, 401)

  const owner = await signIn(baseUrl, identities[0])
  const other = await signIn(baseUrl, identities[1])
  const ownProfile = await request(baseUrl, '/api/users/me', { cookie: owner.cookie })
  assert.equal(ownProfile.status, 200)
  assert.equal((await ownProfile.json()).id, owner.user.id)

  const patchResponse = await request(baseUrl, '/api/users/me', {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { full_name: 'Updated Profile Owner' },
  })
  assert.equal(patchResponse.status, 200)
  assert.equal((await patchResponse.json()).full_name, 'Updated Profile Owner')
  assert.equal((await request(baseUrl, `/api/users/${owner.user.id}`, { cookie: other.cookie })).status, 403)

  const firstPng = await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 46, g: 110, b: 81 } },
  }).png().toBuffer()
  const firstUpload = await uploadImage(baseUrl, owner.cookie, firstPng, 'profile.png', 'image/png')
  assert.equal(firstUpload.status, 200)
  const firstProfile = await firstUpload.json()
  assert.match(firstProfile.avatar_storage_key, new RegExp(`^${owner.user.id}/[0-9a-f-]{36}\\.webp$`))
  assert.equal(firstProfile.profile_image_url, '/api/users/me/avatar')

  const storedKeyResult = await pool.query('SELECT avatar_storage_key FROM users WHERE id = $1', [owner.user.id])
  assert.equal(storedKeyResult.rows[0].avatar_storage_key, firstProfile.avatar_storage_key)
  assert.equal(typeof storedKeyResult.rows[0].avatar_storage_key, 'string')

  const invalidUpload = await uploadImage(baseUrl, owner.cookie, Buffer.from('not an image'), 'profile.png', 'image/png')
  assert.equal(invalidUpload.status, 415)
  const oversizedUpload = await uploadImage(
    baseUrl,
    owner.cookie,
    Buffer.alloc(5 * 1024 * 1024 + 1),
    'oversized.png',
    'image/png',
  )
  assert.equal(oversizedUpload.status, 413)

  const firstImageResponse = await request(baseUrl, '/api/users/me/avatar', { cookie: owner.cookie })
  assert.equal(firstImageResponse.status, 200)
  assert.equal(firstImageResponse.headers.get('content-type'), 'image/webp')
  const firstImageBytes = Buffer.from(await firstImageResponse.arrayBuffer())
  assert.equal(firstImageBytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(firstImageBytes.toString('ascii', 8, 12), 'WEBP')

  const secondPng = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 174, g: 114, b: 83 } },
  }).png().toBuffer()
  const replacement = await uploadImage(baseUrl, owner.cookie, secondPng, 'replacement.png', 'image/png')
  assert.equal(replacement.status, 200)
  const replacedProfile = await replacement.json()
  assert.notEqual(replacedProfile.avatar_storage_key, firstProfile.avatar_storage_key)
  assert.equal(await readProfileImage(owner.user.id, firstProfile.avatar_storage_key), null)
  const replacementImage = await request(baseUrl, '/api/users/me/avatar', { cookie: owner.cookie })
  assert.equal(replacementImage.status, 200)

  const otherProfileImage = await request(baseUrl, '/api/users/me/avatar', { cookie: other.cookie })
  assert.equal(otherProfileImage.status, 404)
  const removed = await request(baseUrl, '/api/users/me/avatar', { method: 'DELETE', cookie: owner.cookie })
  assert.equal(removed.status, 200)
  const removedProfile = await removed.json()
  assert.equal(removedProfile.avatar_storage_key, null)
  assert.equal(removedProfile.profile_image_url, null)
  assert.equal(await readProfileImage(owner.user.id, replacedProfile.avatar_storage_key), null)
  assert.equal((await request(baseUrl, '/api/users/me/avatar', { cookie: owner.cookie })).status, 404)

  result = { getMe: 200, patchMe: 200, upload: 200, invalidImage: 415, oversizedImage: 413, imageRead: 200, replaceAndDeleteOldFile: 'passed', removeAndDeleteFile: 'passed', profileOwnership: 'passed' }
} catch (error) {
  console.error(JSON.stringify({ profileIntegration: 'failed', message: error.message }))
  process.exitCode = 1
} finally {
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  try {
    const emails = identities.map((identity) => identity.email)
    const users = await pool.query(
      'SELECT id, avatar_storage_key FROM users WHERE email = ANY($1::text[])',
      [emails],
    )
    const ids = [...new Set([...userIds, ...users.rows.map((user) => user.id)])]
    for (const user of users.rows) {
      if (user.avatar_storage_key) await deleteProfileImage(user.id, user.avatar_storage_key)
    }
    await pool.query('DELETE FROM user_sessions WHERE sess ->> $1 = ANY($2::text[])', ['userId', ids])
    await pool.query('DELETE FROM otp_challenges WHERE email = ANY($1::text[])', [emails])
    const cleanup = await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[]) RETURNING id', [ids])
    console.log(JSON.stringify({ ...result, temporaryUsersRemoved: cleanup.rowCount }))
  } catch (error) {
    console.error(JSON.stringify({ cleanup: 'failed', code: error.code ?? null }))
    process.exitCode = 1
  }
  await pool.end()
}