import { Resend } from 'resend'

export function isOtpDeliveryAvailable() {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromEmail = process.env.OTP_FROM_EMAIL?.trim()
  if (apiKey && fromEmail) {
    return true
  }

  const production = process.env.NODE_ENV === 'production'
  const deliveryMode = process.env.OTP_DELIVERY_MODE ?? (production ? 'unconfigured' : 'console')
  return !production && deliveryMode === 'console'
}

export async function deliverOtp({ email, code }) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromEmail = process.env.OTP_FROM_EMAIL?.trim()

  if (apiKey && fromEmail) {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: 'Your CareerStudio Sign-in Code',
      html: `<p>Your sign-in verification code is: <strong>${code}</strong></p><p>This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>`,
      text: `Your sign-in verification code is: ${code}\n\nThis code will expire in 10 minutes. If you did not request this, please ignore this email.`,
    })

    if (error) {
      const deliveryError = new Error(`Failed to deliver OTP email: ${error.message || 'Resend error'}`)
      deliveryError.code = 'OTP_EMAIL_DELIVERY_FAILED'
      deliveryError.cause = error
      throw deliveryError
    }
    return
  }

  const production = process.env.NODE_ENV === 'production'
  const deliveryMode = process.env.OTP_DELIVERY_MODE ?? (production ? 'unconfigured' : 'console')

  if (!production && deliveryMode === 'console') {
    console.info(`[development OTP] ${email}: ${code}`)
    return
  }

  throw Object.assign(new Error('OTP delivery is not configured.'), { code: 'OTP_DELIVERY_NOT_CONFIGURED' })
}