import assert from 'node:assert/strict'
import test from 'node:test'
import { requireRole, requireEmployer } from '../middleware/requireAuth.js'

test('requireRole returns 401 when no user is attached to request', () => {
  const req = {}
  let statusCode = 0
  let jsonBody = null
  const res = {
    status(code) {
      statusCode = code
      return {
        json(body) {
          jsonBody = body
        },
      }
    },
  }
  let nextCalled = false
  const next = () => { nextCalled = true }

  const middleware = requireRole('employer')
  middleware(req, res, next)

  assert.equal(statusCode, 401)
  assert.deepEqual(jsonBody, { error: 'Authentication required.' })
  assert.equal(nextCalled, false)
})

test('requireRole defaults to job_seeker when user role is undefined and blocks access', () => {
  const req = { user: { id: 'test-user-id', email: 'seeker@example.com' } }
  let statusCode = 0
  let jsonBody = null
  const res = {
    status(code) {
      statusCode = code
      return {
        json(body) {
          jsonBody = body
        },
      }
    },
  }
  let nextCalled = false
  const next = () => { nextCalled = true }

  requireEmployer(req, res, next)

  assert.equal(statusCode, 403)
  assert.deepEqual(jsonBody, { error: 'Access denied. Required role not granted.' })
  assert.equal(nextCalled, false)
})

test('requireEmployer blocks job_seeker role with 403 Forbidden', () => {
  const req = { user: { id: 'test-user-id', email: 'seeker@example.com', role: 'job_seeker' } }
  let statusCode = 0
  let jsonBody = null
  const res = {
    status(code) {
      statusCode = code
      return {
        json(body) {
          jsonBody = body
        },
      }
    },
  }
  let nextCalled = false
  const next = () => { nextCalled = true }

  requireEmployer(req, res, next)

  assert.equal(statusCode, 403)
  assert.deepEqual(jsonBody, { error: 'Access denied. Required role not granted.' })
  assert.equal(nextCalled, false)
})

test('requireEmployer allows employer role to proceed', () => {
  const req = { user: { id: 'employer-user-id', email: 'employer@company.com', role: 'employer' } }
  let nextCalled = false
  const next = () => { nextCalled = true }
  const res = {}

  requireEmployer(req, res, next)

  assert.equal(nextCalled, true)
})

test('requireEmployer allows recruiter role to proceed', () => {
  const req = { user: { id: 'recruiter-user-id', email: 'recruiter@company.com', role: 'recruiter' } }
  let nextCalled = false
  const next = () => { nextCalled = true }
  const res = {}

  requireEmployer(req, res, next)

  assert.equal(nextCalled, true)
})
