/**
 * TechNova Job Application Assistant
 * Normalized External Job Contract & Sanitization Utilities
 */

/**
 * Strips HTML tags and unescapes common HTML entities from raw descriptions/titles.
 * @param {string} input 
 * @returns {string}
 */
export function stripHtml(input) {
  if (typeof input !== 'string') return ''
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalizes employment type to standard enum values: 'full-time' | 'part-time' | 'contract' | 'internship' | 'other'
 * @param {string} rawType
 * @returns {string}
 */
export function normalizeEmploymentType(rawType) {
  if (!rawType || typeof rawType !== 'string') return 'full-time'
  const clean = rawType.toLowerCase().replace(/[-_\s]/g, '')
  if (clean.includes('fulltime') || clean.includes('permanent')) return 'full-time'
  if (clean.includes('parttime')) return 'part-time'
  if (clean.includes('contract') || clean.includes('freelance') || clean.includes('temp')) return 'contract'
  if (clean.includes('intern') || clean.includes('trainee')) return 'internship'
  return 'full-time'
}

/**
 * Normalizes remote/work mode: 'remote' | 'hybrid' | 'onsite' | null
 * @param {string|boolean} rawMode 
 * @param {string} [contextText] Optional text to scan for remote keywords
 * @returns {string}
 */
export function normalizeRemoteType(rawMode, contextText = '') {
  if (rawMode === true) return 'remote'
  if (typeof rawMode === 'string') {
    const clean = rawMode.toLowerCase()
    if (clean.includes('remote') || clean.includes('telecommute') || clean.includes('wfh')) return 'remote'
    if (clean.includes('hybrid')) return 'hybrid'
    if (clean.includes('onsite') || clean.includes('office')) return 'onsite'
  }
  if (contextText && typeof contextText === 'string') {
    const text = contextText.toLowerCase()
    if (/\b(remote|work from home|100% remote|anywhere)\b/.test(text)) return 'remote'
    if (/\b(hybrid)\b/.test(text)) return 'hybrid'
  }
  return 'onsite'
}

/**
 * Parses salary text or numbers into min, max, and currency
 * @param {string|number} min 
 * @param {string|number} max 
 * @param {string} [currency] 
 * @returns {{ salary_min: number|null, salary_max: number|null, currency: string|null }}
 */
export function normalizeSalary(min, max, currency = 'USD') {
  let minVal = min != null && Number.isFinite(Number(min)) && Number(min) >= 0 ? Number(min) : null
  let maxVal = max != null && Number.isFinite(Number(max)) && Number(max) >= 0 ? Number(max) : null

  if (minVal !== null && maxVal !== null && minVal > maxVal) {
    const temp = minVal
    minVal = maxVal
    maxVal = temp
  }

  const validCurrency = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency)
    ? currency.toUpperCase()
    : (minVal !== null || maxVal !== null ? 'USD' : null)

  return {
    salary_min: minVal,
    salary_max: maxVal,
    currency: validCurrency,
  }
}

/**
 * Parses salary from free-form text strings (e.g. "$120,000 - $140,000 a year")
 * @param {string} text 
 * @returns {{ salary_min: number|null, salary_max: number|null, currency: string|null }}
 */
export function parseSalaryFromText(text) {
  if (!text || typeof text !== 'string') {
    return { salary_min: null, salary_max: null, currency: null }
  }

  let currency = 'USD'
  if (text.includes('£')) currency = 'GBP'
  else if (text.includes('€')) currency = 'EUR'
  else if (text.includes('₹')) currency = 'INR'
  else if (text.includes('C$') || text.includes('CAD')) currency = 'CAD'
  else if (text.includes('$')) currency = 'USD'

  const numbers = text
    .replace(/,/g, '')
    .match(/\d+(?:\.\d+)?/g)

  if (!numbers || numbers.length === 0) {
    return { salary_min: null, salary_max: null, currency: null }
  }

  const parsed = numbers.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  if (parsed.length === 0) {
    return { salary_min: null, salary_max: null, currency: null }
  }

  if (parsed.length === 1) {
    return { salary_min: parsed[0], salary_max: null, currency }
  }

  return {
    salary_min: Math.min(parsed[0], parsed[1]),
    salary_max: Math.max(parsed[0], parsed[1]),
    currency,
  }
}

/**
 * Validates and formats a normalized job according to the system contract.
 * @param {object} input 
 * @returns {object} NormalizedJob
 */
export function createNormalizedJob(input = {}) {
  if (!input.source || typeof input.source !== 'string') {
    throw new Error('Normalized job requires a valid "source" identifier.')
  }
  if (!input.external_id || typeof input.external_id !== 'string') {
    throw new Error('Normalized job requires a valid "external_id" string.')
  }
  if (!input.title || typeof input.title !== 'string') {
    throw new Error('Normalized job requires a valid "title" string.')
  }
  if (!input.company || typeof input.company !== 'string') {
    throw new Error('Normalized job requires a valid "company" string.')
  }
  if (!input.source_url || typeof input.source_url !== 'string') {
    throw new Error('Normalized job requires a valid "source_url" string.')
  }

  const { salary_min, salary_max, currency } = normalizeSalary(
    input.salary_min,
    input.salary_max,
    input.currency,
  )

  const sanitizedMetadata = typeof input.metadata === 'object' && input.metadata !== null
    ? { ...input.metadata }
    : {}

  // Ensure no sensitive authentication tokens or credentials exist in metadata
  delete sanitizedMetadata.app_id
  delete sanitizedMetadata.app_key
  delete sanitizedMetadata.api_key
  delete sanitizedMetadata.key
  delete sanitizedMetadata.token

  return {
    source: input.source.trim().toLowerCase(),
    external_id: String(input.external_id).trim(),
    title: stripHtml(input.title),
    company: stripHtml(input.company),
    location: input.location ? stripHtml(input.location) : null,
    description: input.description ? stripHtml(input.description) : null,
    employment_type: normalizeEmploymentType(input.employment_type),
    remote_type: input.remote_type ?? normalizeRemoteType(null, `${input.title} ${input.location || ''} ${input.description || ''}`),
    industry: input.industry ? stripHtml(input.industry) : null,
    salary_min,
    salary_max,
    currency,
    posted_at: input.posted_at ? new Date(input.posted_at).toISOString() : null,
    source_url: input.source_url.trim(),
    retrieved_at: input.retrieved_at ? new Date(input.retrieved_at).toISOString() : new Date().toISOString(),
    metadata: sanitizedMetadata,
  }
}
