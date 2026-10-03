/**
 * TechNova Job Application Assistant
 * External Job Ingestion & Cache Coordination Service
 * Integrates provider fetching, PostgreSQL caching, deduplication, and stale-fallback.
 */

import { externalJobService } from './externalJobService.js'
import { postgresExternalJobCache } from './cache/postgresExternalJobCache.js'
import { externalJobRepository } from '../../repositories/externalJobRepository.js'
import { computeCacheKey } from './fingerprint.js'
import { getProviderPolicy } from './providerPolicies.js'
import { logger } from '../../lib/logger.js'

export class ExternalJobIngestionService {
  constructor({
    jobService = externalJobService,
    cache = postgresExternalJobCache,
    repository = externalJobRepository,
  } = {}) {
    this.jobService = jobService
    this.cache = cache
    this.repository = repository
  }

  /**
   * Executes search with cache-lookup, provider ingestion, and stale fallback.
   * @param {object} options
   * @param {string} [options.keywords='']
   * @param {string} [options.location='']
   * @param {number} [options.page=1]
   * @param {number} [options.results_per_page=20]
   * @param {string} [options.source='all']
   * @param {string} [options.country='us']
   * @param {number} [options.timeoutMs=7000]
   * @param {boolean} [options.forceRefresh=false]
   * @param {typeof fetch} [options.fetchImpl=globalThis.fetch]
   * @returns {Promise<object>}
   */
  async searchWithCache({
    keywords = '',
    location = '',
    page = 1,
    results_per_page = 20,
    source = 'all',
    country = 'us',
    timeoutMs = 7000,
    forceRefresh = false,
    fetchImpl = globalThis.fetch,
  } = {}) {
    const selectedSource = String(source || 'all').toLowerCase().trim()
    const selectedCountry = String(country || 'us').toLowerCase().trim()
    const targetProviders = []

    if (selectedSource === 'all') {
      for (const provider of this.jobService.providers.values()) {
        if (typeof provider.supportsCountry === 'function' && !provider.supportsCountry(selectedCountry)) {
          continue
        }
        targetProviders.push(provider)
      }
    } else {
      const specificProvider = this.jobService.getProvider(selectedSource)
      if (!specificProvider) {
        throw new Error(
          `Unknown job provider "${selectedSource}". Available: ${this.jobService.getRegisteredProviderNames().join(', ')}`,
        )
      }
      if (typeof specificProvider.supportsCountry === 'function' && !specificProvider.supportsCountry(selectedCountry)) {
        return {
          ok: true,
          query: {
            keywords: keywords.trim(),
            location: location.trim(),
            page: Math.max(1, Math.floor(Number(page) || 1)),
            results_per_page: Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20))),
            source: selectedSource,
          },
          source_results: [
            {
              source: selectedSource,
              configured: specificProvider.isConfigured(),
              status: 'unavailable_for_country',
              message: `Provider ${selectedSource} is not available for country '${selectedCountry}'.`,
              count: 0,
              total_available: 0,
              cached: false,
              stale: false,
              attribution: specificProvider.getAttribution(),
              jobs: [],
            },
          ],
          total_results: 0,
          providers: {
            [selectedSource]: {
              configured: specificProvider.isConfigured(),
              status: 'unavailable_for_country',
              cached: false,
              stale: false,
              message: `Provider ${selectedSource} is not available for country '${selectedCountry}'.`,
            },
          },
        }
      }
      targetProviders.push(specificProvider)
    }

    const providerSearches = targetProviders.map(async (provider) => {
      const providerName = provider.getName()
      const policy = getProviderPolicy(providerName)

      if (!provider.isConfigured()) {
        return {
          source: providerName,
          configured: false,
          status: 'unconfigured',
          message: `Provider ${providerName} is not configured (missing required API credentials).`,
          count: 0,
          total_available: 0,
          cached: false,
          stale: false,
          attribution: provider.getAttribution(),
          jobs: [],
        }
      }

      const cacheKey = computeCacheKey({
        source: providerName,
        keywords,
        location,
        page,
        results_per_page,
        country,
      })

      let cachedEntry = null
      let isStaleCache = false

      try {
        const cacheCheck = await this.cache.get(cacheKey)
        if (cacheCheck.isHit) {
          cachedEntry = cacheCheck.entry
          isStaleCache = cacheCheck.isStale

          // Fresh cache hit
          if (!forceRefresh && !isStaleCache && cachedEntry?.result_job_ids?.length) {
            const cachedJobs = await this.repository.findByIds(cachedEntry.result_job_ids)
            if (cachedJobs.length > 0) {
              return {
                source: providerName,
                configured: true,
                status: 'success',
                count: cachedJobs.length,
                total_available: cachedEntry.total_available || cachedJobs.length,
                cached: true,
                stale: false,
                attribution: cachedEntry.attribution || provider.getAttribution(),
                jobs: cachedJobs,
              }
            }
          }
        }
      } catch (cacheErr) {
        logger.warn('Cache lookup failed, proceeding to provider fetch', {
          provider: providerName,
          error: cacheErr.message,
        })
      }

      // Execute provider search
      try {
        const providerResult = await provider.searchJobs({
          keywords,
          location,
          page,
          results_per_page,
          country,
          timeoutMs,
          fetchImpl,
        })

        // Ingest and upsert normalized jobs into external_jobs table
        const savedJobs = await this.repository.upsertBatch(providerResult.jobs)
        const savedJobIds = savedJobs.map((j) => j.id)

        // Store query result in cache
        try {
          await this.cache.set({
            cacheKey,
            source: providerName,
            queryParams: { keywords, location, page, results_per_page, country },
            resultJobIds: savedJobIds,
            totalAvailable: providerResult.total,
            attribution: providerResult.attribution,
            ttlSeconds: policy.cacheTtlSeconds || 3600,
          })
        } catch (setCacheErr) {
          logger.warn('Failed to store search results in cache', {
            provider: providerName,
            error: setCacheErr.message,
          })
        }

        return {
          source: providerName,
          configured: true,
          status: 'success',
          count: savedJobs.length,
          total_available: providerResult.total,
          cached: false,
          stale: false,
          attribution: providerResult.attribution,
          jobs: savedJobs,
        }
      } catch (providerErr) {
        logger.warn('External provider search failed', {
          provider: providerName,
          error: providerErr.message,
        })

        // Stale cache fallback if provider fails
        if (cachedEntry?.result_job_ids?.length) {
          try {
            const staleJobs = await this.repository.findByIds(cachedEntry.result_job_ids)
            if (staleJobs.length > 0) {
              return {
                source: providerName,
                configured: true,
                status: 'success',
                count: staleJobs.length,
                total_available: cachedEntry.total_available || staleJobs.length,
                cached: true,
                stale: true,
                message: 'Provider temporarily unavailable; serving cached results.',
                attribution: cachedEntry.attribution || provider.getAttribution(),
                jobs: staleJobs,
              }
            }
          } catch (staleErr) {
            logger.warn('Failed to retrieve stale cache fallback', {
              provider: providerName,
              error: staleErr.message,
            })
          }
        }

        // Return isolated provider error
        return {
          source: providerName,
          configured: true,
          status: 'error',
          message: providerErr.message || 'External provider query failed.',
          count: 0,
          total_available: 0,
          cached: false,
          stale: false,
          attribution: provider.getAttribution(),
          jobs: [],
        }
      }
    })

    const settled = await Promise.allSettled(providerSearches)

    const sourceResults = settled.map((res) => {
      if (res.status === 'fulfilled') return res.value
      return {
        source: 'unknown',
        configured: false,
        status: 'error',
        message: res.reason?.message || 'Unexpected search failure.',
        count: 0,
        total_available: 0,
        cached: false,
        stale: false,
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
        cached: res.cached,
        stale: res.stale,
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

  /**
   * Cleans up expired cache entries and prunes stale jobs.
   * @param {object} [options]
   * @param {number} [options.staleDays=14]
   * @returns {Promise<{ prunedCacheEntries: number, prunedStaleJobs: number }>}
   */
  async cleanup({ staleDays = 14 } = {}) {
    const prunedCacheEntries = await this.cache.pruneExpired()
    const prunedStaleJobs = await this.repository.pruneStaleJobs(staleDays)
    return { prunedCacheEntries, prunedStaleJobs }
  }
}

export const externalJobIngestionService = new ExternalJobIngestionService()
