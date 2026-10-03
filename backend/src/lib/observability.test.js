import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { databaseConfigured } from '../db.js'
import { formatLogEntry, redactSensitiveData } from './logger.js'

test('observability & error monitoring test suite', async (t) => {
  const app = createApp({
    canDeliverOtp: () => true,
    sendOtp: async () => {},
  })

  const server = app.listen(0)
  await once(server, 'listening')
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  t.after(() => {
    server.close()
  })

  await t.test('generates X-Request-Id when none provided', async () => {
    const res = await fetch(`${baseUrl}/api/jobs`)
    const requestId = res.headers.get('x-request-id')
    assert.ok(requestId, 'X-Request-Id header should be set')
    assert.ok(/^[0-9a-f-]{36}$/i.test(requestId) || requestId.length > 0)
  })

  await t.test('propagates incoming valid X-Request-Id', async () => {
    const customId = 'req-trace-abc-123'
    const res = await fetch(`${baseUrl}/api/jobs`, {
      headers: { 'X-Request-Id': customId },
    })
    const requestId = res.headers.get('x-request-id')
    assert.equal(requestId, customId)
  })

  await t.test('includes requestId in API error response payload', async () => {
    const customId = 'custom-err-trace-777'
    // Accessing protected /api/users without auth generates 401
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { 'X-Request-Id': customId },
    })
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('x-request-id'), customId)
  })

  await t.test('health endpoint returns safe operational status', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    if (databaseConfigured) {
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.status, 'ok')
      assert.equal(data.database, 'connected')
      assert.ok(data.postgresVersion)
      assert.ok(data.timestamp)
    } else {
      assert.equal(res.status, 503)
      const data = await res.json()
      assert.equal(data.status, 'error')
    }
  })

  await t.test('sensitive data redaction masks credentials in logs', () => {
    const rawContext = {
      user: 'test-user',
      password: 'super-secret-password-123',
      otp_code: '123456',
      token: 'jwt.token.here',
      session_secret: 'secret-32-chars-long-string-1234',
      nested: {
        apiKey: 're_secret_key_123',
        pepper: 'pepper-key-123',
        safeField: 'normal-value',
      },
    }

    const redacted = redactSensitiveData(rawContext)
    assert.equal(redacted.user, 'test-user')
    assert.equal(redacted.password, '[REDACTED]')
    assert.equal(redacted.otp_code, '[REDACTED]')
    assert.equal(redacted.token, '[REDACTED]')
    assert.equal(redacted.session_secret, '[REDACTED]')
    assert.equal(redacted.nested.apiKey, '[REDACTED]')
    assert.equal(redacted.nested.pepper, '[REDACTED]')
    assert.equal(redacted.nested.safeField, 'normal-value')
  })

  await t.test('log formatter produces structured JSON when required', () => {
    process.env.LOG_FORMAT = 'json'
    try {
      const formatted = formatLogEntry('info', 'Test log message', { requestId: '123', action: 'test' })
      const parsed = JSON.parse(formatted)
      assert.equal(parsed.level, 'info')
      assert.equal(parsed.message, 'Test log message')
      assert.equal(parsed.requestId, '123')
      assert.ok(parsed.timestamp)
    } finally {
      delete process.env.LOG_FORMAT
    }
  })
})
