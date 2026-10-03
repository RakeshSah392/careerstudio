import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { otpPepper } from '../auth/secrets.js'

export const otpLifetimeMinutes = 10
export const otpMaximumAttempts = 5

export function generateOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function hashOtp(email, code) {
  return createHmac('sha256', otpPepper)
    .update(`${email.trim().toLowerCase()}:${code}`)
    .digest('hex')
}

export function verifyOtpHash(email, code, storedHash) {
  if (!/^\d{6}$/.test(code) || typeof storedHash !== 'string' || !/^[a-f\d]{64}$/i.test(storedHash)) {
    return false
  }
  const candidate = Buffer.from(hashOtp(email, code), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  return timingSafeEqual(candidate, stored)
}