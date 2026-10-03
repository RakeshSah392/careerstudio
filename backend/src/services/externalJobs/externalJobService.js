/**
 * TechNova Job Application Assistant
 * External Job Aggregator Service
 * Orchestrates multiple external job board connectors with provider isolation and fallback.
 */

import { AdzunaJobProvider } from './providers/adzunaJobProvider.js'
import { ArbeitnowJobProvider } from './providers/arbeitnowJobProvider.js'
import { JoobleJobProvider } from './providers/joobleJobProvider.js'
import { logger } from '../../lib/logger.js'

export class ExternalJobService {
  constructor({
    providers = [
      new AdzunaJobProvider(),
      new ArbeitnowJobProvider(),
      new JoobleJobProvider(),
    ],
  } = {}) {
    this.providers = new Map()
    for (const provider of providers) {
      this.registerProvider(provider)
    }
  }

  registerProvider(provider) {
    if (!provider || typeof provider.getName !== 'function') {
      throw new Error('Invalid provider: must implement JobProviderInterface.')
    }
    this.providers.set(provider.getName(), provider)
  }

  getProvider(name) {
    return this.providers.get(name.toLowerCase()) || null
  }

  getRegisteredProviderNames() {
    return Array.from(this.providers.keys())
  }

  getProvidersStatus() {
    const status = {}
    for (const [name, provider] of this.providers.entries()) {
      status[name] = {
        name: provider.getName(),
        configured: provider.isConfigured(),
        attribution: provider.getAttribution(),
      }
    }
    return status
  }

  /**
   * Executes external search across one or all configured job providers with complete failure isolation.
   * @param {object} options
   * @param {string} [options.keywords]
   * @param {string} [options.location]
   * @param {number} [options.page=1]
   * @param {number} [options.results_per_page=20]
   * @param {string} [options.source='all']
   * @param {string} [options.country='us']
   * @param {number} [options.timeoutMs=7000]
   * @param {typeof fetch} [options.fetchImpl=globalThis.fetch]
   * @returns {Promise<object>}
   */
  async searchJobs({
    keywords = '',
    location = '',
    page = 1,
    results_per_page = 20,
    source = 'all',
    country = 'us',
    timeoutMs = 7000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    const selectedSource = String(source || 'all').toLowerCase().trim()
    const targetProviders = []

    if (selectedSource === 'all') {
      for (const provider of this.providers.values()) {
        targetProviders.push(provider)
      }
    } else {
      const specificProvider = this.getProvider(selectedSource)
      if (!specificProvider) {
        throw new Error(
          `Unknown job provider "${selectedSource}". Available providers: ${this.getRegisteredProviderNames().join(', ')}`,
        )
      }
      targetProviders.push(specificProvider)
    }

    const searchPromises = targetProviders.map(async (provider) => {
      const providerName = provider.getName()
      const isConfigured = provider.isConfigured()

      if (!isConfigured) {
        return {
          source: providerName,
          configured: false,
          status: 'unconfigured',
          message: `Provider ${providerName} is not configured (missing required API credentials).`,
          count: 0,
          total_available: 0,
          attribution: provider.getAttribution(),
          jobs: [],
        }
      }

      try {
        const result = await provider.searchJobs({
          keywords,
          location,
          page,
          results_per_page,
          country,
          timeoutMs,
          fetchImpl,
        })

        return {
          source: providerName,
          configured: true,
          status: 'success',
          count: result.jobs.length,
          total_available: result.total,
          attribution: result.attribution,
          jobs: result.jobs,
        }
      } catch (err) {
        logger.warn('External provider query failed', {
          provider: providerName,
          error: err.message,
        })

        return {
          source: providerName,
          configured: true,
          status: 'error',
          message: err.message || 'External provider query failed.',
          count: 0,
          total_available: 0,
          attribution: provider.getAttribution(),
          jobs: [],
        }
      }
    })

    const settled = await Promise.allSettled(searchPromises)

    const sourceResults = settled.map((res) => {
      if (res.status === 'fulfilled') {
        return res.value
      }
      return {
        source: 'unknown',
        configured: false,
        status: 'error',
        message: res.reason?.message || 'Unexpected provider execution error.',
        count: 0,
        total_available: 0,
        attribution: null,
        jobs: [],
      }
    })

    let totalResults = 0
    const providersSummary = {}

    for (const res of sourceResults) {
      totalResults += res.count
      providersSummary[res.source] = {
        configured: res.configured,
        status: res.status,
        ...(res.message ? { message: res.message } : {}),
      }
    }

    return {
      ok: true,
      query: {
        keywords: keywords.trim(),
        location: location.trim(),
        page: Math.max(1, Math.floor(Number(page) || 1)),
        results_per_page: Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20))),
        source: selectedSource,
      },
      source_results: sourceResults,
      total_results: totalResults,
      providers: providersSummary,
    }
  }
}

export const externalJobService = new ExternalJobService()
