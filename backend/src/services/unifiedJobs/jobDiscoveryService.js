/**
 * TechNova Job Application Assistant
 * Unified Job Discovery & Search Service
 * Merges internal recruiter jobs and external aggregated jobs into a single paginated discovery feed.
 */

import { pool } from '../../db.js'
import { externalJobIngestionService } from '../externalJobs/externalJobIngestionService.js'
import { generateFingerprint } from '../externalJobs/fingerprint.js'
import { scoreJob } from '../matchJobs.js'
import { fromInternalJob, fromExternalJob } from './unifiedJobAdapter.js'
import { logger } from '../../lib/logger.js'

export class JobDiscoveryService {
  constructor({
    dbPool = pool,
    externalIngestion = externalJobIngestionService,
    scorer = scoreJob,
  } = {}) {
    this.pool = dbPool
    this.externalIngestion = externalIngestion
    this.scorer = scorer
  }

  /**
   * Fetches internal recruiter jobs matching filter criteria.
   * @private
   */
  async fetchInternalJobs({
    keywords = '',
    location = '',
    workMode = 'any',
    employmentType = 'any',
    minSalary = null,
  } = {}) {
    const values = ['open']
    const conditions = ['status = $1']

    if (keywords && keywords.trim()) {
      values.push(`%${keywords.trim()}%`)
      conditions.push(
        `(company ILIKE $${values.length} OR title ILIKE $${values.length} OR location ILIKE $${values.length} OR industry ILIKE $${values.length} OR description ILIKE $${values.length})`,
      )
    }

    if (location && location.trim()) {
      values.push(`%${location.trim()}%`)
      conditions.push(`location ILIKE $${values.length}`)
    }

    if (workMode && workMode.toLowerCase() !== 'any') {
      values.push(workMode.toLowerCase().trim())
      conditions.push(`LOWER(remote_type) = $${values.length}`)
    }

    if (employmentType && employmentType.toLowerCase() !== 'any') {
      const normEmp = employmentType.toLowerCase().replace(/[-_\s]/g, '')
      values.push(`%${normEmp}%`)
      conditions.push(`LOWER(REPLACE(REPLACE(employment_type, '-', ''), '_', '')) LIKE $${values.length}`)
    }

    if (minSalary != null && Number.isFinite(Number(minSalary)) && Number(minSalary) > 0) {
      values.push(Number(minSalary))
      conditions.push(
        `((salary_max IS NOT NULL AND salary_max >= $${values.length}) OR (salary_max IS NULL AND salary_min IS NOT NULL AND salary_min >= $${values.length}))`,
      )
    }

    const query = `
      SELECT id, created_by_user_id, company, title, location, remote_type, employment_type,
             industry, description, source_url, salary_min, salary_max, currency, status,
             posted_at, created_at, updated_at
      FROM jobs
      WHERE ${conditions.join(' AND ')}
      ORDER BY posted_at DESC NULLS LAST, created_at DESC
    `

    try {
      const result = await this.pool.query(query, values)
      return result.rows
    } catch (err) {
      logger.error('Failed to query internal jobs for discovery', { error: err.message })
      return []
    }
  }

  /**
   * Fetches user job preferences for personalized matching.
   * @private
   */
  async getUserPreferences(userId) {
    if (!userId) return null
    try {
      const result = await this.pool.query(
        'SELECT * FROM job_preferences WHERE user_id = $1 LIMIT 1',
        [userId],
      )
      return result.rows[0] || null
    } catch (err) {
      logger.warn('Failed to fetch user preferences for match scoring', { userId, error: err.message })
      return null
    }
  }

  /**
   * Filters external jobs in-memory based on structured search constraints.
   * @private
   */
  filterExternalJobs(jobs, { workMode = 'any', employmentType = 'any', minSalary = null } = {}) {
    return jobs.filter((job) => {
      // Work mode filter
      if (workMode && workMode.toLowerCase() !== 'any') {
        const targetMode = workMode.toLowerCase().trim()
        const jobMode = (job.remote_type || (job.is_remote ? 'remote' : 'onsite')).toLowerCase()
        if (jobMode !== targetMode) return false
      }

      // Employment type filter
      if (employmentType && employmentType.toLowerCase() !== 'any') {
        const normTarget = employmentType.toLowerCase().replace(/[-_\s]/g, '')
        const normJob = (job.employment_type || 'full-time').toLowerCase().replace(/[-_\s]/g, '')
        if (!normJob.includes(normTarget) && !normTarget.includes(normJob)) return false
      }

      // Minimum salary filter (never fabricate missing salary)
      if (minSalary != null && Number.isFinite(Number(minSalary)) && Number(minSalary) > 0) {
        const minReq = Number(minSalary)
        const maxSalary = job.salary_max != null ? Number(job.salary_max) : null
        const minSalaryVal = job.salary_min != null ? Number(job.salary_min) : null

        if (maxSalary !== null && maxSalary < minReq) return false
        if (maxSalary === null && minSalaryVal !== null && minSalaryVal < minReq) return false
        if (maxSalary === null && minSalaryVal === null) {
          // If job lists no salary at all, keep it rather than eliminating unlisted roles,
          // unless strict minimum salary filter requires listed salary.
        }
      }

      return true
    })
  }

  /**
   * Merges and deduplicates internal and external jobs.
   * Internal verified recruiter postings take precedence over external syndications.
   * @private
   */
  mergeAndDeduplicate(internalUnifiedList, externalUnifiedList) {
    const seenFingerprints = new Set()
    const merged = []

    // 1. Add internal jobs first (highest authority)
    for (const job of internalUnifiedList) {
      const fp = generateFingerprint({
        company: job.company,
        title: job.title,
        location: job.location,
        employmentType: job.employment_type,
      })
      seenFingerprints.add(fp)
      merged.push(job)
    }

    // 2. Add non-duplicate external jobs
    for (const job of externalUnifiedList) {
      const fp = generateFingerprint({
        company: job.company,
        title: job.title,
        location: job.location,
        employmentType: job.employment_type,
      })
      if (!seenFingerprints.has(fp)) {
        seenFingerprints.add(fp)
        merged.push(job)
      }
    }

    return merged
  }

  /**
   * Executes unified job discovery search across internal and external sources with matching, sorting, and pagination.
   * @param {object} options
   * @param {object|null} [options.user] - Authenticated user context
   * @param {string} [options.keywords='']
   * @param {string} [options.location='']
   * @param {string} [options.work_mode='any']
   * @param {string} [options.employment_type='any']
   * @param {number|null} [options.min_salary=null]
   * @param {string} [options.source='all'] - 'all' | 'internal' | 'adzuna' | 'arbeitnow' | 'jooble'
   * @param {string} [options.country='in'] - Defaults to 'in' (India)
   * @param {number} [options.page=1]
   * @param {number} [options.results_per_page=20]
   * @param {string} [options.sort='best_match'] - 'best_match' | 'latest'
   * @param {boolean} [options.forceRefresh=false]
   * @returns {Promise<object>}
   */
  async searchUnified({
    user = null,
    keywords = '',
    location = '',
    work_mode = 'any',
    employment_type = 'any',
    min_salary = null,
    source = 'all',
    country = 'in',
    page = 1,
    results_per_page = 20,
    sort = 'best_match',
    forceRefresh = false,
  } = {}) {
    const selectedSource = String(source || 'all').toLowerCase().trim()
    const selectedCountry = String(country || 'in').toLowerCase().trim()
    const pageNum = Math.max(1, Math.floor(Number(page) || 1))
    const limitNum = Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20)))
    const sortOrder = sort === 'latest' ? 'latest' : 'best_match'

    // 1. Fetch user preferences if user is authenticated for deterministic match scoring
    const preferences = user ? await this.getUserPreferences(user.id) : null

    // 2. Fetch Internal Jobs if source includes internal
    let internalUnified = []
    if (selectedSource === 'all' || selectedSource === 'internal') {
      const internalRows = await this.fetchInternalJobs({
        keywords,
        location,
        workMode: work_mode,
        employmentType: employment_type,
        minSalary: min_salary,
      })

      internalUnified = internalRows.map((job) => {
        const matchResult = preferences ? this.scorer(job, preferences) : null
        return fromInternalJob(job, matchResult)
      })
    }

    // 3. Fetch External Jobs if source includes external providers
    let externalUnified = []
    let providersSummary = {}

    if (selectedSource !== 'internal') {
      try {
        const externalResult = await this.externalIngestion.searchWithCache({
          keywords,
          location,
          page: 1,
          results_per_page: 50,
          source: selectedSource,
          country: selectedCountry,
          forceRefresh,
        })

        providersSummary = externalResult.providers || {}

        // Collect all external jobs from source results
        const rawExternalJobs = []
        for (const sRes of externalResult.source_results || []) {
          if (Array.isArray(sRes.jobs)) {
            rawExternalJobs.push(...sRes.jobs)
          }
        }

        // Apply in-memory filters to external jobs
        const filteredExternal = this.filterExternalJobs(rawExternalJobs, {
          workMode: work_mode,
          employmentType: employment_type,
          minSalary: min_salary,
        })

        externalUnified = filteredExternal.map((extJob) => {
          // Map external job fields into standard matching contract
          const matchingInput = {
            title: extJob.title,
            location: extJob.location,
            remote_type: extJob.is_remote ? 'remote' : (extJob.remote_type || 'onsite'),
            salary_min: extJob.salary_min,
            salary_max: extJob.salary_max,
            employment_type: extJob.employment_type ? extJob.employment_type.replace('_', '-') : 'full-time',
            industry: extJob.industry || '',
          }
          const matchResult = preferences ? this.scorer(matchingInput, preferences) : null
          return fromExternalJob(extJob, matchResult)
        })
      } catch (externalErr) {
        logger.warn('External job search failed during unified search, continuing with internal results', {
          error: externalErr.message,
        })
      }
    }

    // 4. Merge and Deduplicate across internal and external records
    const mergedList = this.mergeAndDeduplicate(internalUnified, externalUnified)

    // 5. Apply Deterministic Sorting
    if (sortOrder === 'best_match') {
      mergedList.sort((a, b) => {
        const scoreA = a.match_score
        const scoreB = b.match_score
        const hasA = typeof scoreA === 'number'
        const hasB = typeof scoreB === 'number'

        if (hasA && hasB && scoreA !== scoreB) return scoreB - scoreA
        if (hasA && !hasB) return -1
        if (!hasA && hasB) return 1

        // Tie-break with posted timestamp
        const timeA = a.posted_at ? new Date(a.posted_at).getTime() : 0
        const timeB = b.posted_at ? new Date(b.posted_at).getTime() : 0
        if (timeA !== timeB) return timeB - timeA

        return String(a.id).localeCompare(String(b.id))
      })
    } else {
      // Latest posted
      mergedList.sort((a, b) => {
        const timeA = a.posted_at ? new Date(a.posted_at).getTime() : 0
        const timeB = b.posted_at ? new Date(b.posted_at).getTime() : 0
        if (timeA !== timeB) return timeB - timeA
        return String(a.id).localeCompare(String(b.id))
      })
    }

    // 6. Server-Side Pagination
    const totalResults = mergedList.length
    const totalPages = Math.max(1, Math.ceil(totalResults / limitNum))
    const offset = (pageNum - 1) * limitNum
    const paginatedJobs = mergedList.slice(offset, offset + limitNum)

    return {
      ok: true,
      query: {
        keywords: keywords.trim(),
        location: location.trim(),
        work_mode,
        employment_type,
        min_salary,
        source: selectedSource,
        country: selectedCountry,
        sort: sortOrder,
        page: pageNum,
        results_per_page: limitNum,
      },
      pagination: {
        page: pageNum,
        results_per_page: limitNum,
        total_results: totalResults,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
      jobs: paginatedJobs,
      providers: providersSummary,
    }
  }
}

export const jobDiscoveryService = new JobDiscoveryService()
