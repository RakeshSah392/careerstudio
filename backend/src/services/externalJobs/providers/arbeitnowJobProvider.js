/**
 * TechNova Job Application Assistant
 * Arbeitnow Job Provider Adapter
 * Official API Documentation: https://www.arbeitnow.com/blog/job-board-api
 */

import { JobProviderInterface } from '../jobProviderInterface.js'
import { createNormalizedJob } from '../normalizedJob.js'
import { logger } from '../../../lib/logger.js'

export class ArbeitnowJobProvider extends JobProviderInterface {
  constructor({
    baseUrl = 'https://www.arbeitnow.com/api/job-board-api',
  } = {}) {
    super()
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  getName() {
    return 'arbeitnow'
  }

  isConfigured() {
    // Arbeitnow is an open job board API and requires no API key.
    return true
  }

  supportsCountry(country = 'in') {
    const norm = String(country || 'in').toLowerCase().trim()
    // Arbeitnow is specialized for European/German tech listings and is disabled for India ('in')
    return norm !== 'in'
  }

  getAttribution() {
    return {
      name: 'Arbeitnow',
      text: 'Jobs via Arbeitnow (https://www.arbeitnow.com)',
      url: 'https://www.arbeitnow.com',
    }
  }

  async searchJobs({
    keywords = '',
    location = '',
    page = 1,
    results_per_page = 20,
    timeoutMs = 7000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    const safePage = Math.max(1, Math.floor(Number(page) || 1))
    const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20)))

    const params = new URLSearchParams({
      page: String(safePage),
    })

    const searchTerms = [keywords, location].filter((s) => typeof s === 'string' && s.trim()).join(' ')
    if (searchTerms.trim()) {
      params.set('search', searchTerms.trim())
    }

    const requestUrl = `${this.baseUrl}?${params.toString()}`

    let controller
    let timeoutId
    try {
      let signal
      if (typeof AbortSignal.timeout === 'function') {
        signal = AbortSignal.timeout(timeoutMs)
      } else {
        controller = new AbortController()
        timeoutId = setTimeout(() => controller.abort(), timeoutMs)
        signal = controller.signal
      }

      const response = await fetchImpl(requestUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      })

      if (!response.ok) {
        logger.warn('Arbeitnow API returned non-2xx status', {
          provider: 'arbeitnow',
          status: response.status,
        })
        throw new Error(`Arbeitnow API returned status ${response.status}`)
      }

      const body = await response.json()
      const rawList = Array.isArray(body?.data) ? body.data : []
      const total = Number(body?.meta?.total) || rawList.length

      // Slice to requested results_per_page
      const pagedSlice = rawList.slice(0, safeLimit)

      const normalizedJobs = pagedSlice.map((item) => {
        const jobTypes = Array.isArray(item.job_types) ? item.job_types.join(', ') : (item.job_types || 'full_time')
        const tags = Array.isArray(item.tags) ? item.tags : []

        let postedDate = null
        if (item.created_at) {
          postedDate = typeof item.created_at === 'number'
            ? new Date(item.created_at * 1000).toISOString()
            : new Date(item.created_at).toISOString()
        }

        return createNormalizedJob({
          source: this.getName(),
          external_id: String(item.slug || Math.random().toString(36).substring(2)),
          title: item.title || 'Untitled Role',
          company: item.company_name || 'Direct Employer',
          location: item.location || (item.remote ? 'Remote' : null),
          description: item.description || null,
          employment_type: jobTypes,
          remote_type: item.remote === true ? 'remote' : null,
          industry: tags.length > 0 ? tags.slice(0, 3).join(', ') : null,
          salary_min: null,
          salary_max: null,
          currency: null,
          posted_at: postedDate,
          source_url: item.url || `https://www.arbeitnow.com/jobs/${item.slug}`,
          metadata: {
            slug: item.slug,
            tags,
            remote: Boolean(item.remote),
            attribution: this.getAttribution().text,
          },
        })
      })

      return {
        jobs: normalizedJobs,
        total,
        attribution: this.getAttribution(),
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.includes('aborted')) {
        throw new Error(`Arbeitnow request timed out after ${timeoutMs}ms.`)
      }
      throw err
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
}
