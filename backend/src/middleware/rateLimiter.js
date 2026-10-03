import rateLimit from 'express-rate-limit'

export function createGlobalRateLimiter(options = {}) {
  const isTest = process.env.NODE_ENV === 'test'
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || options.windowMs || 15 * 60 * 1000
  const limit = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || options.limit || (isTest ? 10000 : 500)

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (request) => {
      if (typeof options.skip === 'function' && options.skip(request)) return true
      const path = request.path || request.originalUrl || ''
      return path === '/health' || path === '/api/health'
    },
    message: { error: 'Too many requests from this IP, please try again later.' },
    ...options,
  })
}
