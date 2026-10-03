import { randomUUID } from 'node:crypto'
import { logger } from '../lib/logger.js'

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

export function requestIdMiddleware(options = {}) {
  return (request, response, next) => {
    const incomingId = request.headers['x-request-id'] || request.headers['x-correlation-id']
    const requestId = typeof incomingId === 'string' && VALID_ID_PATTERN.test(incomingId.trim())
      ? incomingId.trim()
      : randomUUID()

    request.id = requestId
    request.requestId = requestId
    response.setHeader('X-Request-Id', requestId)

    const start = Date.now()

    response.on('finish', () => {
      const durationMs = Date.now() - start
      const isHealthCheck = request.path === '/api/health' || request.path === '/health'

      // In production, keep info logs for requests; debug for health checks
      if (isHealthCheck) {
        logger.debug('Health check probe', {
          requestId,
          method: request.method,
          path: request.originalUrl || request.path,
          status: response.statusCode,
          durationMs,
        })
      } else {
        logger.info('HTTP request completed', {
          requestId,
          method: request.method,
          path: request.originalUrl || request.path,
          status: response.statusCode,
          durationMs,
        })
      }
    })

    next()
  }
}
