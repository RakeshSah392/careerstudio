import assert from 'node:assert/strict'
import test from 'node:test'
import { runPreflight, validateProductionConfig } from './preflight.js'

test('production preflight test suite', async (t) => {
  await t.test('passes in development environment', () => {
    const devEnv = { NODE_ENV: 'development' }
    const result = validateProductionConfig(devEnv)
    assert.equal(result.valid, true)
    assert.equal(result.errors.length, 0)
    assert.doesNotThrow(() => runPreflight(devEnv))
  })

  await t.test('passes in test environment', () => {
    const testEnv = { NODE_ENV: 'test' }
    const result = validateProductionConfig(testEnv)
    assert.equal(result.valid, true)
    assert.equal(result.errors.length, 0)
  })

  await t.test('fails in production when DATABASE_URL is missing or invalid', () => {
    const prodEnv = {
      NODE_ENV: 'production',
      SESSION_SECRET: 'a'.repeat(32),
      OTP_PEPPER: 'b'.repeat(32),
      RESEND_API_KEY: 're_123456789',
      OTP_FROM_EMAIL: 'CareerStudio <noreply@example.com>',
    }

    // Missing DB
    const missingDb = validateProductionConfig(prodEnv)
    assert.equal(missingDb.valid, false)
    assert.ok(missingDb.errors.some((e) => e.includes('DATABASE_URL is required')))

    // Invalid DB URL scheme
    const invalidDb = validateProductionConfig({ ...prodEnv, DATABASE_URL: 'mysql://localhost/db' })
    assert.equal(invalidDb.valid, false)
    assert.ok(invalidDb.errors.some((e) => e.includes('valid PostgreSQL connection URL')))
  })

  await t.test('fails in production when SESSION_SECRET or OTP_PEPPER is too short', () => {
    const prodEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost:5432/career',
      SESSION_SECRET: 'short_secret',
      OTP_PEPPER: 'short_pepper',
      RESEND_API_KEY: 're_123456789',
      OTP_FROM_EMAIL: 'noreply@example.com',
    }

    const result = validateProductionConfig(prodEnv)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes('SESSION_SECRET must be at least 32 characters')))
    assert.ok(result.errors.some((e) => e.includes('OTP_PEPPER must be at least 32 characters')))
  })

  await t.test('fails in production when Resend configuration is missing', () => {
    const prodEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/career',
      SESSION_SECRET: 's'.repeat(32),
      OTP_PEPPER: 'p'.repeat(32),
    }

    const result = validateProductionConfig(prodEnv)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes('RESEND_API_KEY is required')))
    assert.ok(result.errors.some((e) => e.includes('OTP_FROM_EMAIL is required')))
  })

  await t.test('never leaks secret values in error messages', () => {
    const secretValue = 'MY_SUPER_SECRET_VALUE_1234567890'
    const prodEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: `postgres://user:${secretValue}@localhost:5432/db`,
      SESSION_SECRET: 'short',
      OTP_PEPPER: 'short',
      RESEND_API_KEY: '',
      OTP_FROM_EMAIL: 'invalid-email',
    }

    const result = validateProductionConfig(prodEnv)
    assert.equal(result.valid, false)
    for (const error of result.errors) {
      assert.ok(!error.includes(secretValue), 'Secret leaked in error message!')
    }

    assert.throws(
      () => runPreflight(prodEnv),
      (err) => {
        assert.ok(!err.message.includes(secretValue))
        return true
      },
    )
  })

  await t.test('passes with complete and valid production configuration', () => {
    const prodEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://career_user:strong_password@postgres.internal:5432/career_db?sslmode=require',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      OTP_PEPPER: 'abcdef0123456789abcdef0123456789',
      RESEND_API_KEY: 're_test_123456789',
      OTP_FROM_EMAIL: 'CareerStudio <auth@careerstudio.app>',
    }

    const result = validateProductionConfig(prodEnv)
    assert.equal(result.valid, true)
    assert.equal(result.errors.length, 0)
    assert.doesNotThrow(() => runPreflight(prodEnv))
  })
})
