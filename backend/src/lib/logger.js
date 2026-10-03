import { randomUUID } from 'node:crypto'

const SENSITIVE_KEY_PATTERN = /(password|code|otp|secret|pepper|token|authorization|cookie|apikey|api_key|resend|credential)/i

export function redactSensitiveData(obj, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return obj
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, depth + 1))
  }

  const redacted = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value, depth + 1)
    } else {
      redacted[key] = value
    }
  }
  return redacted
}

export function formatLogEntry(level, message, context = {}) {
  const isProduction = process.env.NODE_ENV === 'production'
  const isTest = process.env.NODE_ENV === 'test'
  const forceJson = process.env.LOG_FORMAT === 'json'

  const safeContext = redactSensitiveData(context)
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...safeContext,
  }

  if (isProduction || forceJson) {
    return JSON.stringify(entry)
  }

  // Development/Test readable output
  const meta = Object.keys(safeContext).length ? ` ${JSON.stringify(safeContext)}` : ''
  return `[${entry.timestamp}] [${level.toUpperCase()}] ${message}${meta}`
}

export const logger = {
  info(message, context) {
    console.info(formatLogEntry('info', message, context))
  },
  warn(message, context) {
    console.warn(formatLogEntry('warn', message, context))
  },
  error(message, context) {
    console.error(formatLogEntry('error', message, context))
  },
  debug(message, context) {
    if (process.env.NODE_ENV !== 'production' || process.env.LOG_LEVEL === 'debug') {
      console.debug(formatLogEntry('debug', message, context))
    }
  },
}

export function requestIdMiddleware(request, response, next) {
  const incoming = request.headers['x-request-id']
  const requestId = typeof incoming === 'string' && incoming.trim()
    ? incoming.trim()
    : randomUUID()
  request.requestId = requestId
  response.setHeader('X-Request-Id', requestId)
  next()
}

export function requestLoggingMiddleware(request, response, next) {
  const start = Date.now()
  response.on('finish', () => {
    const durationMs = Date.now() - start
    logger.info('HTTP request completed', {
      requestId: request.requestId,
      method: request.method,
      path: request.originalUrl || request.path,
      status: response.statusCode,
      durationMs,
    })
  })
  next()
}

