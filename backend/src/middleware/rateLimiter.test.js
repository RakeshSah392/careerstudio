import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../app.js'
import { createGlobalRateLimiter } from './rateLimiter.js'

test('global rate limiter test suite', async (t) => {
  const customLimiter = createGlobalRateLimiter({
    windowMs: 60 * 1000,
    limit: 3,
  })

  const app = createApp({
    canDeliverOtp: () => true,
    sendOtp: async () => {},
    rateLimiter: customLimiter,
  })

  const server = app.listen(0)
  await once(server, 'listening')
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  t.after(() => {
    server.close()
  })

  await t.test('allows requests under the limit and returns rate limit headers', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/jobs`)
      // Should not be 429
      assert.notEqual(res.status, 429)
      assert.ok(res.headers.get('ratelimit-limit'))
    }
  })

  await t.test('blocks subsequent requests exceeding limit with 429 Too Many Requests', async () => {
    const res = await fetch(`${baseUrl}/api/jobs`)
    assert.equal(res.status, 429)
    const body = await res.json()
    assert.ok(body.error)
    assert.ok(body.error.includes('Too many requests'))
  })

  await t.test('health endpoint is exempt from rate limiting', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    // /api/health should not be blocked by 429
    assert.notEqual(res.status, 429)
  })
})
