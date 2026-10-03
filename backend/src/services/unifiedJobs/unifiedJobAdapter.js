/**
 * TechNova Job Application Assistant
 * Unified Job Representation Adapter
 * Standardizes internal recruiter jobs and external aggregated jobs into a unified format.
 */

import { getProviderPolicy } from '../externalJobs/providerPolicies.js'

/**
 * Normalizes remote_type / is_remote into standard 'remote' | 'hybrid' | 'onsite'
 */
export function normalizeRemoteType(value, isRemote = false) {
  if (isRemote) return 'remote'
  if (!value) return 'onsite'
  const clean = String(value).toLowerCase().trim()
  if (clean === 'remote' || clean.includes('remote') || clean.includes('work from home')) return 'remote'
  if (clean === 'hybrid') return 'hybrid'
  return 'onsite'
}

/**
 * Normalizes employment type into standard 'full-time' | 'part-time' | 'contract' | 'internship' | 'temporary' | 'other'
 */
export function normalizeEmploymentType(value) {
  if (!value) return 'full-time'
  const clean = String(value).toLowerCase().replace(/_/g, '-').trim()
  if (clean.includes('full')) return 'full-time'
  if (clean.includes('part')) return 'part-time'
  if (clean.includes('contract')) return 'contract'
  if (clean.includes('intern')) return 'internship'
  if (clean.includes('temp')) return 'temporary'
  return clean || 'full-time'
}

/**
 * Formats an internal recruiter job record into the unified job domain model.
 * @param {object} job - PostgreSQL jobs row
 * @param {object|null} [matchResult] - Output from scoreJob()
 * @returns {object} Unified job object
 */
export function fromInternalJob(job, matchResult = null) {
  if (!job) return null

  const remoteType = normalizeRemoteType(job.remote_type)
  const employmentType = normalizeEmploymentType(job.employment_type)

  return {
    id: job.id,
    source_type: 'internal',
    source: 'internal',
    external_id: null,
    title: job.title || '',
    company: job.company || '',
    location: job.location || '',
    country: job.country || 'in',
    remote_type: remoteType,
    employment_type: employmentType,
    industry: job.industry || '',
    description: job.description || '',
    salary_min: job.salary_min != null ? Number(job.salary_min) : null,
    salary_max: job.salary_max != null ? Number(job.salary_max) : null,
    currency: job.currency || 'INR',
    posted_at: job.posted_at || job.created_at || null,
    source_url: job.source_url || '',
    apply_url: job.source_url || '',
    attribution: 'CareerStudio Recruiter Verified',
    match_score: typeof matchResult?.score === 'number' ? matchResult.score : null,
    match_breakdown: matchResult?.score_breakdown || null,
    is_external: false,
    created_by_user_id: job.created_by_user_id || null,
  }
}

/**
 * Formats an external ingested job record into the unified job domain model.
 * @param {object} extJob - Normalized external job row or object
 * @param {object|null} [matchResult] - Output from scoreJob()
 * @returns {object} Unified job object
 */
export function fromExternalJob(extJob, matchResult = null) {
  if (!extJob) return null

  const sourceName = String(extJob.source || 'external').toLowerCase()
  const policy = getProviderPolicy(sourceName)
  const remoteType = normalizeRemoteType(extJob.remote_type, extJob.is_remote)
  const employmentType = normalizeEmploymentType(extJob.employment_type)

  return {
    id: extJob.id,
    source_type: 'external',
    source: sourceName,
    external_id: extJob.external_id || null,
    title: extJob.title || '',
    company: extJob.company || '',
    location: extJob.location || '',
    country: extJob.country || 'in',
    remote_type: remoteType,
    employment_type: employmentType,
    industry: extJob.industry || '',
    description: extJob.description_snippet || extJob.description || '',
    salary_min: extJob.salary_min != null ? Number(extJob.salary_min) : null,
    salary_max: extJob.salary_max != null ? Number(extJob.salary_max) : null,
    currency: extJob.salary_currency || extJob.currency || (extJob.country === 'in' ? 'INR' : 'USD'),
    posted_at: extJob.posted_at || extJob.first_seen_at || extJob.created_at || null,
    source_url: extJob.source_url || extJob.apply_url || '',
    apply_url: extJob.apply_url || extJob.source_url || '',
    attribution: extJob.attribution_text || policy.attributionText || `Jobs provided by ${sourceName}`,
    match_score: typeof matchResult?.score === 'number' ? matchResult.score : null,
    match_breakdown: matchResult?.score_breakdown || null,
    is_external: true,
    created_by_user_id: null,
  }
}
