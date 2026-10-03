const emailRegex = /^\S+@\S+\.\S+$/
const emailWithSenderRegex = /^([^<]+<)?\S+@\S+\.\S+>?$/

export function validateProductionConfig(env = process.env) {
  const errors = []
  const isProduction = env.NODE_ENV === 'production'

  if (!isProduction) {
    return { valid: true, errors: [] }
  }

  // 1. DATABASE_URL
  const dbUrl = env.DATABASE_URL?.trim()
  if (!dbUrl) {
    errors.push('DATABASE_URL is required in production.')
  } else if (!dbUrl.startsWith('postgres://') && !dbUrl.startsWith('postgresql://')) {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection URL.')
  }

  // 2. SESSION_SECRET
  const sessionSecret = env.SESSION_SECRET
  if (typeof sessionSecret !== 'string' || sessionSecret.trim().length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters long in production.')
  }

  // 3. OTP_PEPPER
  const otpPepper = env.OTP_PEPPER
  if (typeof otpPepper !== 'string' || otpPepper.trim().length < 32) {
    errors.push('OTP_PEPPER must be at least 32 characters long in production.')
  }

  // 4. RESEND_API_KEY & OTP_FROM_EMAIL
  const deliveryMode = env.OTP_DELIVERY_MODE ?? 'resend'
  if (deliveryMode !== 'mock' && deliveryMode !== 'disabled') {
    const resendApiKey = env.RESEND_API_KEY?.trim()
    if (!resendApiKey) {
      errors.push('RESEND_API_KEY is required in production when email delivery is enabled.')
    }

    const fromEmail = env.OTP_FROM_EMAIL?.trim()
    if (!fromEmail) {
      errors.push('OTP_FROM_EMAIL is required in production when email delivery is enabled.')
    } else if (!emailWithSenderRegex.test(fromEmail) && !emailRegex.test(fromEmail)) {
      errors.push('OTP_FROM_EMAIL must be a valid sender email address.')
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    }
  }

  return { valid: true, errors: [] }
}

export function runPreflight(env = process.env) {
  const result = validateProductionConfig(env)
  if (!result.valid) {
    const message = [
      'Production configuration preflight check failed:',
      ...result.errors.map((err) => `  - ${err}`),
      'Process exiting due to missing or invalid production environment configuration.',
    ].join('\n')
    throw new Error(message)
  }
}
