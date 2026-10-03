/**
 * TechNova Job Application Assistant
 * Adzuna Job Provider Adapter
 * Official Developer Documentation: https://developer.adzuna.com/docs/search
 */

import { JobProviderInterface } from '../jobProviderInterface.js'
import { createNormalizedJob } from '../normalizedJob.js'
import { logger } from '../../../lib/logger.js'

export class AdzunaJobProvider extends JobProviderInterface {
  constructor({
    appId = process.env.ADZUNA_APP_ID,
    appKey = process.env.ADZUNA_APP_KEY,
    baseUrl = 'https://api.adzuna.com/v1/api/jobs',
  } = {}) {
    super()
    this.appId = appId?.trim() || null
    this.appKey = appKey?.trim() || null
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  getName() {
    return 'adzuna'
  }

  isConfigured() {
    return Boolean(this.appId && this.appKey)
  }

  getAttribution() {
    return {
      name: 'Adzuna',
      text: 'Jobs powered by Adzuna',
      url: 'https://www.adzuna.com',
    }
  }

  async searchJobs({
    keywords = '',
    location = '',
    page = 1,
    results_per_page = 20,
    country = 'us',
    timeoutMs = 7000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!this.isConfigured()) {
      throw new Error('Adzuna provider is not configured. Missing ADZUNA_APP_ID or ADZUNA_APP_KEY.')
    }

    const safeCountry = String(country || 'us').toLowerCase().trim()
    const safePage = Math.max(1, Math.floor(Number(page) || 1))
    const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20)))

    const params = new URLSearchParams({
      app_id: this.appId,
      app_key: this.appKey,
      results_per_page: String(safeLimit),
      'content-type': 'application/json',
    })

    if (keywords && typeof keywords === 'string' && keywords.trim()) {
      params.set('what', keywords.trim())
    }
    if (location && typeof location === 'string' && location.trim()) {
      params.set('where', location.trim())
    }

    const requestUrl = `${this.baseUrl}/${safeCountry}/search/${safePage}?${params.toString()}`

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
        let errMessage = `Adzuna API returned status ${response.status}`
        if (response.status === 401 || response.status === 403) {
          errMessage = 'Adzuna authentication failed. Please verify API credentials.'
        } else if (response.status === 429) {
          errMessage = 'Adzuna rate limit exceeded.'
        }
        logger.warn('Adzuna provider returned non-2xx status', {
          provider: 'adzuna',
          status: response.status,
        })
        throw new Error(errMessage)
      }

      const data = await response.json()
      const rawResults = Array.isArray(data?.results) ? data.results : []
      const total = Number(data?.count) || rawResults.length

      const normalizedJobs = rawResults.map((item) =>
        createNormalizedJob({
          source: this.getName(),
          external_id: String(item.id || Math.random().toString(36).substring(2)),
          title: item.title || 'Untitled Role',
          company: item.company?.display_name || 'Confidential Employer',
          location: item.location?.display_name || (Array.isArray(item.location?.area) ? item.location.area.join(', ') : null),
          description: item.description || null,
          employment_type: item.contract_time || item.contract_type || 'full-time',
          industry: item.category?.label || null,
          salary_min: item.salary_min,
          salary_max: item.salary_max,
          currency: item.salary_currency || (safeCountry === 'gb' ? 'GBP' : safeCountry === 'in' ? 'INR' : safeCountry === 'ca' ? 'CAD' : 'USD'),
          posted_at: item.created || null,
          source_url: item.redirect_url || `https://www.adzuna.com/land/ad/${item.id}`,
          metadata: {
            adzuna_id: item.id,
            category: item.category?.tag || null,
            salary_is_predicted: Boolean(item.salary_is_predicted),
            attribution: this.getAttribution().text,
          },
        }),
      )

      return {
        jobs: normalizedJobs,
        total,
        attribution: this.getAttribution(),
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.includes('aborted')) {
        throw new Error(`Adzuna request timed out after ${timeoutMs}ms.`)
      }
      throw err
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
}
