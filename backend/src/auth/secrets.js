import { randomBytes } from 'node:crypto'

const production = process.env.NODE_ENV === 'production'

if (production && (
  typeof process.env.SESSION_SECRET !== 'string' || process.env.SESSION_SECRET.length < 32
  || typeof process.env.OTP_PEPPER !== 'string' || process.env.OTP_PEPPER.length < 32
)) {
  throw new Error('SESSION_SECRET and OTP_PEPPER must each contain at least 32 characters in production.')
}

export const sessionSecret = process.env.SESSION_SECRET ?? randomBytes(48).toString('base64url')
export const otpPepper = process.env.OTP_PEPPER ?? randomBytes(32)
export const sessionCookieName = 'career.sid'

if (!production && (!process.env.SESSION_SECRET || !process.env.OTP_PEPPER)) {
  console.warn('Development auth secrets are ephemeral; sessions and outstanding OTPs will expire on restart.')
}