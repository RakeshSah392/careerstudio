import assert from 'node:assert/strict'
import test from 'node:test'
import { generateOtp, hashOtp, otpLifetimeMinutes, otpMaximumAttempts, verifyOtpHash } from './otp.js'

test('generates six-digit OTPs and stores only an email-bound HMAC', () => {
  const code = generateOtp()
  const hash = hashOtp('Person@example.com', code)

  assert.match(code, /^\d{6}$/)
  assert.match(hash, /^[a-f\d]{64}$/)
  assert.notEqual(hash, code)
  assert.equal(verifyOtpHash('person@example.com', code, hash), true)
  assert.equal(verifyOtpHash('other@example.com', code, hash), false)
  assert.equal(verifyOtpHash('person@example.com', '00000x', hash), false)
  assert.equal(otpLifetimeMinutes, 10)
  assert.equal(otpMaximumAttempts, 5)
})