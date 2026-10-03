import assert from 'node:assert/strict'
import test from 'node:test'
import { isOtpDeliveryAvailable, deliverOtp } from './otpDelivery.js'

test('isOtpDeliveryAvailable returns true when Resend is configured', () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalEmail = process.env.OTP_FROM_EMAIL
  const originalMode = process.env.OTP_DELIVERY_MODE
  const originalNodeEnv = process.env.NODE_ENV

  try {
    process.env.RESEND_API_KEY = 're_test_key_123'
    process.env.OTP_FROM_EMAIL = 'onboarding@resend.dev'
    process.env.NODE_ENV = 'production'
    assert.equal(isOtpDeliveryAvailable(), true)
  } finally {
    process.env.RESEND_API_KEY = originalKey
    process.env.OTP_FROM_EMAIL = originalEmail
    process.env.OTP_DELIVERY_MODE = originalMode
    process.env.NODE_ENV = originalNodeEnv
  }
})

test('isOtpDeliveryAvailable returns true in development console mode', () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalEmail = process.env.OTP_FROM_EMAIL
  const originalMode = process.env.OTP_DELIVERY_MODE
  const originalNodeEnv = process.env.NODE_ENV

  try {
    delete process.env.RESEND_API_KEY
    delete process.env.OTP_FROM_EMAIL
    process.env.NODE_ENV = 'development'
    process.env.OTP_DELIVERY_MODE = 'console'
    assert.equal(isOtpDeliveryAvailable(), true)
  } finally {
    process.env.RESEND_API_KEY = originalKey
    process.env.OTP_FROM_EMAIL = originalEmail
    process.env.OTP_DELIVERY_MODE = originalMode
    process.env.NODE_ENV = originalNodeEnv
  }
})

test('isOtpDeliveryAvailable returns false in production when unconfigured', () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalEmail = process.env.OTP_FROM_EMAIL
  const originalMode = process.env.OTP_DELIVERY_MODE
  const originalNodeEnv = process.env.NODE_ENV

  try {
    delete process.env.RESEND_API_KEY
    delete process.env.OTP_FROM_EMAIL
    process.env.NODE_ENV = 'production'
    delete process.env.OTP_DELIVERY_MODE
    assert.equal(isOtpDeliveryAvailable(), false)
  } finally {
    process.env.RESEND_API_KEY = originalKey
    process.env.OTP_FROM_EMAIL = originalEmail
    process.env.OTP_DELIVERY_MODE = originalMode
    process.env.NODE_ENV = originalNodeEnv
  }
})

test('deliverOtp logs in console mode when Resend is not configured in development', async () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalEmail = process.env.OTP_FROM_EMAIL
  const originalMode = process.env.OTP_DELIVERY_MODE
  const originalNodeEnv = process.env.NODE_ENV

  try {
    delete process.env.RESEND_API_KEY
    delete process.env.OTP_FROM_EMAIL
    process.env.NODE_ENV = 'development'
    process.env.OTP_DELIVERY_MODE = 'console'

    let logged = ''
    const originalInfo = console.info
    console.info = (msg) => { logged = msg }

    try {
      await deliverOtp({ email: 'test@example.com', code: '123456' })
      assert.equal(logged, '[development OTP] test@example.com: 123456')
    } finally {
      console.info = originalInfo
    }
  } finally {
    process.env.RESEND_API_KEY = originalKey
    process.env.OTP_FROM_EMAIL = originalEmail
    process.env.OTP_DELIVERY_MODE = originalMode
    process.env.NODE_ENV = originalNodeEnv
  }
})

test('deliverOtp throws OTP_DELIVERY_NOT_CONFIGURED in production when unconfigured', async () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalEmail = process.env.OTP_FROM_EMAIL
  const originalMode = process.env.OTP_DELIVERY_MODE
  const originalNodeEnv = process.env.NODE_ENV

  try {
    delete process.env.RESEND_API_KEY
    delete process.env.OTP_FROM_EMAIL
    process.env.NODE_ENV = 'production'
    delete process.env.OTP_DELIVERY_MODE

    await assert.rejects(
      () => deliverOtp({ email: 'test@example.com', code: '123456' }),
      (err) => err.code === 'OTP_DELIVERY_NOT_CONFIGURED',
    )
  } finally {
    process.env.RESEND_API_KEY = originalKey
    process.env.OTP_FROM_EMAIL = originalEmail
    process.env.OTP_DELIVERY_MODE = originalMode
    process.env.NODE_ENV = originalNodeEnv
  }
})

