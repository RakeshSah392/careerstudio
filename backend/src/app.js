import express from 'express'
import helmet from 'helmet'
import { createSessionMiddleware } from './auth/session.js'
import { checkDatabaseConnection, databaseConfigured } from './db.js'
import { requestIdMiddleware, requestLoggingMiddleware } from './lib/logger.js'
import aiRouter from './routes/ai.js'
import applicationsRouter from './routes/applications.js'
import applicationProfileRouter from './routes/applicationProfile.js'
import { createAuthRouter } from './routes/auth.js'
import autoApplyRouter from './routes/autoApply.js'
import employerRouter from './routes/employer.js'
import externalJobsRouter from './routes/externalJobs.js'
import jobsRouter from './routes/jobs.js'
import matchesRouter from './routes/matches.js'
import preferencesRouter from './routes/preferences.js'
import resumesRouter from './routes/resumes.js'
import usersRouter from './routes/users.js'
import { requireAuth } from './middleware/requireAuth.js'
import { deliverOtp, isOtpDeliveryAvailable } from './services/otpDelivery.js'

export function createApp({ sendOtp = deliverOtp, canDeliverOtp = isOtpDeliveryAvailable } = {}) {
  const app = express()
  const isProduction = process.env.NODE_ENV === 'production'
  if (isProduction) app.set('trust proxy', 1)

  app.use(requestIdMiddleware)
  app.use(requestLoggingMiddleware)
  app.use(helmet())
  app.use(express.json({ limit: '1mb' }))
  app.use(createSessionMiddleware())

  app.get('/api/health', async (_request, response) => {
    if (!databaseConfigured) {
      return response.status(503).json({
        status: 'error',
        database: 'not_configured',
        timestamp: new Date().toISOString(),
      })
    }
    try {
      const { serverVersion, majorVersion } = await checkDatabaseConnection()
      if (majorVersion !== 18) {
        return response.status(503).json({
          status: 'error',
          database: 'unsupported_version',
          postgresVersion: serverVersion,
          expectedMajorVersion: 18,
          timestamp: new Date().toISOString(),
        })
      }
      response.json({
        status: 'ok',
        database: 'connected',
        postgresVersion: serverVersion,
        timestamp: new Date().toISOString(),
      })
    } catch {
      response.status(503).json({
        status: 'error',
        database: 'unavailable',
        timestamp: new Date().toISOString(),
      })
    }
  })

  app.use('/api/auth', createAuthRouter({ sendOtp, canDeliverOtp }))
  app.use('/api/users', requireAuth, usersRouter)
  app.use('/api/resumes', requireAuth, resumesRouter)
  app.use('/api/preferences', requireAuth, preferencesRouter)
  app.use('/api/application-profile', requireAuth, applicationProfileRouter)
  app.use('/api/auto-apply', requireAuth, autoApplyRouter)
  app.use('/api/jobs/external', externalJobsRouter)
  app.use('/api/jobs', jobsRouter)
  app.use('/api/employer', employerRouter)
  app.use('/api/matches', requireAuth, matchesRouter)
  app.use('/api/applications', requireAuth, applicationsRouter)
  app.use('/api/ai', requireAuth, aiRouter)

  app.use('/api', (request, response) => {
    response.status(404).json({
      error: 'API route not found.',
      requestId: request.requestId,
    })
  })

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error)
    console.error('API request failed:', error.message)
    const statusByCode = {
      DB_NOT_CONFIGURED: 503,
      OTP_DELIVERY_NOT_CONFIGURED: 503,
      INVALID_IMAGE: 415,
      IMAGE_TOO_LARGE: 413,
      INVALID_RESUME_FILE: 415,
      LIMIT_FILE_SIZE: 413,
      LIMIT_FILE_COUNT: 400,
      LIMIT_FIELD_COUNT: 400,
      LIMIT_PART_COUNT: 400,
      LIMIT_UNEXPECTED_FILE: 400,
      '22P02': 400,
      '23502': 400,
      '23503': 400,
      '23505': 409,
      '23514': 400,
    }
    const status = statusByCode[error.code] ?? error.status ?? 500
    response.status(status).json({
      error: status < 500 ? 'The request contains invalid or conflicting data.' : 'The request could not be completed.',
      requestId: request.requestId,
    })
  })

  return app
}