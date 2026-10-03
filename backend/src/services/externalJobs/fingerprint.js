/**
 * TechNova Job Application Assistant
 * Job Fingerprinting, Deduplication & Cache Key Utilities
 */

import { createHash } from 'node:crypto'

/**
 * Normalizes text: trims, lowercases, strips special characters, collapses whitespace.
 * @param {string} str 
 * @returns {string}
 */
export function normalizeText(str) {
  if (!str || typeof str !== 'string') return ''
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalizes company names by stripping common corporate suffixes.
 * e.g. "Stripe, Inc." -> "stripe", "Google LLC" -> "google"
 * @param {string} company 
 * @returns {string}
 */
export function normalizeCompany(company) {
  const text = normalizeText(company)
  return text
    .replace(/\b(inc|incorporated|llc|corp|corporation|ltd|limited|gmbh|co|company)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalizes location or work mode.
 * @param {string} location 
 * @param {string} [remoteType] 
 * @returns {string}
 */
export function normalizeLocation(location, remoteType) {
  if (remoteType === 'remote') return 'remote'
  const text = normalizeText(location)
  if (/\b(remote|telecommute|wfh|anywhere)\b/.test(text)) return 'remote'
  return text || 'unspecified'
}

/**
 * Computes a conservative 64-character SHA-256 fingerprint for cross-provider duplicate detection.
 * Requires company, title, location/workmode, and employment type.
 * @param {object} job
 * @param {string} job.company
 * @param {string} job.title
 * @param {string} [job.location]
 * @param {string} [job.remote_type]
 * @param {string} [job.employment_type]
 * @returns {string} 64-character hex hash
 */
export function computeJobFingerprint({
  company = '',
  title = '',
  location = '',
  remote_type = '',
  employment_type = 'full-time',
} = {}) {
  const normComp = normalizeCompany(company)
  const normTitle = normalizeText(title)
  const normLoc = normalizeLocation(location, remote_type)
  const normEmp = normalizeText(employment_type || 'full-time')

  const canonicalString = `${normComp}|${normTitle}|${normLoc}|${normEmp}`

  return createHash('sha256').update(canonicalString).digest('hex')
}

export const generateFingerprint = computeJobFingerprint


/**
 * Generates a normalized, deterministic cache key for search queries.
 * @param {object} params
 * @param {string} params.source
 * @param {string} [params.keywords='']
 * @param {string} [params.location='']
 * @param {number} [params.page=1]
 * @param {number} [params.results_per_page=20]
 * @param {string} [params.country='us']
 * @returns {string} 64-character hex hash
 */
export function computeCacheKey({
  source = 'all',
  keywords = '',
  location = '',
  page = 1,
  results_per_page = 20,
  country = 'us',
} = {}) {
  const normSource = normalizeText(source || 'all')
  const normKw = normalizeText(keywords || '')
  const normLoc = normalizeText(location || '')
  const normPage = Math.max(1, Math.floor(Number(page) || 1))
  const normLimit = Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20)))
  const normCountry = normalizeText(country || 'us')

  const canonicalQuery = `source=${normSource}&kw=${normKw}&loc=${normLoc}&page=${normPage}&limit=${normLimit}&country=${normCountry}`

  return createHash('sha256').update(canonicalQuery).digest('hex')
}
