/**
 * TechNova Job Application Assistant
 * Jooble Job Provider Adapter
 * Official REST API Documentation: https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation
 */

import { JobProviderInterface } from '../jobProviderInterface.js'
import { createNormalizedJob, parseSalaryFromText } from '../normalizedJob.js'
import { logger } from '../../../lib/logger.js'

export class JoobleJobProvider extends JobProviderInterface {
  constructor({
    apiKey = process.env.JOOBLE_API_KEY,
    baseUrl = 'https://jooble.org/api',
  } = {}) {
    super()
    this.apiKey = apiKey?.trim() || null
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  getName() {
    return 'jooble'
  }

  isConfigured() {
    return Boolean(this.apiKey)
  }

  getAttribution() {
    return {
      name: 'Jooble',
      text: 'Jobs powered by Jooble',
      url: 'https://jooble.org',
    }
  }

  async searchJobs({
    keywords = '',
    location = '',
    page = 1,
    results_per_page = 20,
    radius = '25',
    timeoutMs = 7000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!this.isConfigured()) {
      throw new Error('Jooble provider is not configured. Missing JOOBLE_API_KEY.')
    }

    const safePage = Math.max(1, Math.floor(Number(page) || 1))
    const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20)))

    const requestUrl = `${this.baseUrl}/${encodeURIComponent(this.apiKey)}`

    const payload = {
      keywords: keywords ? String(keywords).trim() : '',
      location: location ? String(location).trim() : '',
      radius: String(radius || '25'),
      page: String(safePage),
    }

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
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      })

      if (!response.ok) {
        let errMessage = `Jooble API returned status ${response.status}`
        if (response.status === 401 || response.status === 403) {
          errMessage = 'Jooble authentication failed. Please verify API key.'
        } else if (response.status === 429) {
          errMessage = 'Jooble rate limit exceeded or quota exhausted.'
        }
        logger.warn('Jooble provider returned non-2xx status', {
          provider: 'jooble',
          status: response.status,
        })
        throw new Error(errMessage)
      }

      const data = await response.json()
      const rawJobs = Array.isArray(data?.jobs) ? data.jobs : []
      const total = Number(data?.totalCount) || rawJobs.length

      const pagedSlice = rawJobs.slice(0, safeLimit)

      const normalizedJobs = pagedSlice.map((item) => {
        const { salary_min, salary_max, currency } = parseSalaryFromText(item.salary)

        return createNormalizedJob({
          source: this.getName(),
          external_id: String(item.id || Math.random().toString(36).substring(2)),
          title: item.title || 'Untitled Role',
          company: item.company || 'Direct Employer',
          location: item.location || null,
          description: item.snippet || null,
          employment_type: item.type || 'full-time',
          salary_min,
          salary_max,
          currency,
          posted_at: item.updated || null,
          source_url: item.link || 'https://jooble.org',
          metadata: {
            jooble_id: item.id,
            jooble_source: item.source || null,
            raw_salary_text: item.salary || null,
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
        throw new Error(`Jooble request timed out after ${timeoutMs}ms.`)
      }
      throw err
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
}
