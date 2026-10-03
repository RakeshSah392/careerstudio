/**
 * TechNova Job Application Assistant
 * Step 11.5 — External Job Feed Automation & Reliability Service
 * Coordinates automated & on-demand ingestion refreshes, provider isolation,
 * rate limit protection, deduplication, diagnostics, and lifecycle cleanup.
 */

import { pool } from '../../db.js'
import { externalJobService } from './externalJobService.js'
import { externalJobIngestionService } from './externalJobIngestionService.js'
import { postgresExternalJobCache } from './cache/postgresExternalJobCache.js'
import { externalJobRepository } from '../../repositories/externalJobRepository.js'
import { computeCacheKey, generateFingerprint } from './fingerprint.js'
import { getProviderPolicy } from './providerPolicies.js'
import { logger } from '../../lib/logger.js'

export class ExternalJobRefreshService {
  constructor({
    dbPool = pool,
    jobService = externalJobService,
    ingestionService = externalJobIngestionService,
    cache = postgresExternalJobCache,
    repository = externalJobRepository,
  } = {}) {
    this.pool = dbPool
    this.jobService = jobService
    this.ingestionService = ingestionService
    this.cache = cache
    this.repository = repository
  }

  /**
   * Executes a robust, isolated refresh across target external job providers.
   * Isolates provider failures, rate limits, and network errors.
   *
   * @param {object} options
   * @param {string} [options.keywords='']
   * @param {string} [options.location='']
   * @param {string} [options.country='in']
   * @param {string|Array<string>} [options.providers='all']
   * @param {number} [options.page=1]
   * @param {number} [options.results_per_page=20]
   * @param {boolean} [options.forceRefresh=false]
   * @param {number} [options.timeoutMs=7000]
   * @param {number} [options.staleDays=14]
   * @param {typeof fetch} [options.fetchImpl=globalThis.fetch]
   * @returns {Promise<object>}
   */
  async refreshExternalJobs({
    keywords = '',
    location = '',
    country = 'in',
    providers = 'all',
    page = 1,
    results_per_page = 20,
    forceRefresh = false,
    timeoutMs = 7000,
    staleDays = 14,
    fetchImpl = globalThis.fetch,
  } = {}) {
    const startTime = Date.now()
    const selectedCountry = String(country || 'in').toLowerCase().trim()
    const pageNum = Math.max(1, Math.floor(Number(page) || 1))
    const limitNum = Math.min(50, Math.max(1, Math.floor(Number(results_per_page) || 20)))

    // Determine target provider adapters
    const targetProviders = []
    const requestedSources = Array.isArray(providers)
      ? providers.map((p) => String(p).toLowerCase().trim())
      : [String(providers || 'all').toLowerCase().trim()]

    if (requestedSources.includes('all')) {
      for (const provider of this.jobService.providers.values()) {
        if (typeof provider.supportsCountry === 'function' && !provider.supportsCountry(selectedCountry)) {
          continue
        }
        targetProviders.push(provider)
      }
    } else {
      for (const name of requestedSources) {
        const provider = this.jobService.getProvider(name)
        if (provider) {
          if (typeof provider.supportsCountry === 'function' && !provider.supportsCountry(selectedCountry)) {
            logger.info('Skipping provider not supported for country during refresh', { provider: name, country: selectedCountry })
            continue
          }
          targetProviders.push(provider)
        } else {
          logger.warn('Requested unknown external provider during refresh', { provider: name })
        }
      }
    }

    logger.info('External job feed refresh started', {
      keywords,
      location,
      country: selectedCountry,
      providerCount: targetProviders.length,
      forceRefresh,
    })

    const metrics = {
      total_fetched: 0,
      total_normalized: 0,
      total_upserted: 0,
      total_deduplicated: 0,
      cache_hits: 0,
      stale_fallbacks: 0,
      pruned_records: 0,
    }

    const providerStatuses = {}
    const allNormalizedJobs = []

    // Execute provider operations concurrently with strict isolation
    const providerTasks = targetProviders.map(async (provider) => {
      const providerName = provider.getName()
      const policy = getProviderPolicy(providerName)

      // 1. Check if configured
      if (!provider.isConfigured()) {
        providerStatuses[providerName] = {
          status: 'unconfigured',
          configured: false,
          count: 0,
          cached: false,
          stale: false,
          message: `Provider ${providerName} is not configured (missing credentials).`,
        }
        return
      }

      const cacheKey = computeCacheKey({
        source: providerName,
        keywords,
        location,
        page: pageNum,
        results_per_page: limitNum,
        country: selectedCountry,
      })

      let cachedEntry = null
      let isStaleCache = false

      // 2. Check Cache
      try {
        const cacheCheck = await this.cache.get(cacheKey)
        if (cacheCheck.isHit) {
          cachedEntry = cacheCheck.entry
          isStaleCache = cacheCheck.isStale

          if (!forceRefresh && !isStaleCache && cachedEntry?.result_job_ids?.length) {
            const cachedJobs = await this.repository.findByIds(cachedEntry.result_job_ids)
            if (cachedJobs.length > 0) {
              metrics.cache_hits += 1
              metrics.total_fetched += cachedJobs.length
              providerStatuses[providerName] = {
                status: 'cached',
                configured: true,
                count: cachedJobs.length,
                total_available: cachedEntry.total_available || cachedJobs.length,
                cached: true,
                stale: false,
                attribution: cachedEntry.attribution || provider.getAttribution(),
              }
              allNormalizedJobs.push(...cachedJobs)
              return
            }
          }
        }
      } catch (cacheErr) {
        logger.warn('Cache check failed during refresh, proceeding with provider fetch', {
          provider: providerName,
          error: cacheErr.message,
        })
      }

      // 3. Fetch from provider with timeout & rate-limit isolation
      try {
        logger.info('Calling external job provider', { provider: providerName, country: selectedCountry })
        const providerResult = await provider.searchJobs({
          keywords,
          location,
          page: pageNum,
          results_per_page: limitNum,
          country: selectedCountry,
          timeoutMs,
          fetchImpl,
        })

        const rawJobs = Array.isArray(providerResult?.jobs) ? providerResult.jobs : []
        metrics.total_fetched += rawJobs.length
        metrics.total_normalized += rawJobs.length

        // Deduplicate within this provider batch
        const seenBatchFp = new Set()
        const uniqueJobs = []
        for (const j of rawJobs) {
          const fp = j.fingerprint || generateFingerprint({
            company: j.company,
            title: j.title,
            location: j.location,
            remote_type: j.remote_type,
            employment_type: j.employment_type,
          })
          if (!seenBatchFp.has(fp)) {
            seenBatchFp.add(fp)
            uniqueJobs.push(j)
          } else {
            metrics.total_deduplicated += 1
          }
        }

        // Upsert into repository
        const savedJobs = await this.repository.upsertBatch(uniqueJobs)
        metrics.total_upserted += savedJobs.length
        const savedJobIds = savedJobs.map((j) => j.id)

        // Store in search cache
        try {
          await this.cache.set({
            cacheKey,
            source: providerName,
            queryParams: {
              keywords,
              location,
              page: pageNum,
              results_per_page: limitNum,
              country: selectedCountry,
            },
            resultJobIds: savedJobIds,
            totalAvailable: providerResult.total || savedJobs.length,
            attribution: providerResult.attribution || provider.getAttribution(),
            ttlSeconds: policy.cacheTtlSeconds || 3600,
          })
        } catch (setCacheErr) {
          logger.warn('Failed to update cache after provider refresh', {
            provider: providerName,
            error: setCacheErr.message,
          })
        }

        providerStatuses[providerName] = {
          status: 'success',
          configured: true,
          count: savedJobs.length,
          total_available: providerResult.total || savedJobs.length,
          cached: false,
          stale: false,
          attribution: providerResult.attribution || provider.getAttribution(),
        }
        allNormalizedJobs.push(...savedJobs)
      } catch (providerErr) {
        const isRateLimit = providerErr.status === 429 || /rate limit|quota|429/i.test(providerErr.message)
        logger.warn('External provider refresh failed', {
          provider: providerName,
          error: providerErr.message,
          rateLimited: isRateLimit,
        })

        // Stale Cache Fallback
        if (cachedEntry?.result_job_ids?.length) {
          try {
            const staleJobs = await this.repository.findByIds(cachedEntry.result_job_ids)
            if (staleJobs.length > 0) {
              metrics.stale_fallbacks += 1
              providerStatuses[providerName] = {
                status: isRateLimit ? 'rate_limited' : 'stale',
                configured: true,
                count: staleJobs.length,
                total_available: cachedEntry.total_available || staleJobs.length,
                cached: true,
                stale: true,
                message: isRateLimit
                  ? 'Provider rate limit reached; serving cached stale data.'
                  : 'Provider temporarily unavailable; serving cached stale data.',
                attribution: cachedEntry.attribution || provider.getAttribution(),
              }
              allNormalizedJobs.push(...staleJobs)
              return
            }
          } catch (staleErr) {
            logger.warn('Failed to retrieve stale fallback', {
              provider: providerName,
              error: staleErr.message,
            })
          }
        }

        // Return error status for this provider without failing others
        providerStatuses[providerName] = {
          status: isRateLimit ? 'rate_limited' : 'failed',
          configured: true,
          count: 0,
          total_available: 0,
          cached: false,
          stale: false,
          message: providerErr.message || 'Provider query failed.',
        }
      }
    })

    await Promise.allSettled(providerTasks)

    // 4. Safe Non-blocking Lifecycle Cleanup
    try {
      const cleanupResult = await this.cleanup({ staleDays })
      metrics.pruned_records = (cleanupResult.prunedCacheEntries || 0) + (cleanupResult.prunedStaleJobs || 0)
    } catch (cleanupErr) {
      logger.warn('External lifecycle cleanup encountered an issue', { error: cleanupErr.message })
    }

    const durationMs = Date.now() - startTime
    logger.info('External job feed refresh completed', {
      durationMs,
      metrics,
      providerStatuses,
    })

    return {
      ok: true,
      refreshed_at: new Date().toISOString(),
      duration_ms: durationMs,
      query: {
        keywords: keywords.trim(),
        location: location.trim(),
        country: selectedCountry,
        page: pageNum,
        results_per_page: limitNum,
        force_refresh: forceRefresh,
      },
      metrics,
      providers: providerStatuses,
      jobs: allNormalizedJobs,
    }
  }

  /**
   * Cleans up expired cache entries and prunes stale jobs beyond retention days.
   * @param {object} [options]
   * @param {number} [options.staleDays=14]
   * @returns {Promise<{ prunedCacheEntries: number, prunedStaleJobs: number }>}
   */
  async cleanup({ staleDays = 14 } = {}) {
    const prunedCacheEntries = await this.cache.pruneExpired()
    const prunedStaleJobs = await this.repository.pruneStaleJobs(staleDays)
    return { prunedCacheEntries, prunedStaleJobs }
  }

  /**
   * Collects safe developer and operational diagnostics for external feeds.
   * Never leaks API keys, session tokens, or raw credentials.
   * @returns {Promise<object>}
   */
  async getDiagnostics() {
    const [providersStatus, cacheStats, jobStats] = await Promise.all([
      this.jobService.getProvidersStatus(),
      this.pool.query(`
        SELECT
          COUNT(*)::int AS total_searches_cached,
          COUNT(*) FILTER (WHERE expires_at > NOW())::int AS fresh_entries,
          COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS stale_entries,
          MAX(updated_at) AS latest_cache_update
        FROM external_job_searches_cache
      `),
      this.pool.query(`
        SELECT
          source,
          COUNT(*)::int AS count,
          MAX(last_seen_at) AS latest_seen_at,
          COUNT(*) FILTER (WHERE last_seen_at < NOW() - INTERVAL '7 days')::int AS stale_count
        FROM external_jobs
        GROUP BY source
      `),
    ])

    let totalStoredJobs = 0
    let totalStaleJobs = 0
    const sourceBreakdown = {}

    for (const row of jobStats.rows) {
      totalStoredJobs += row.count
      totalStaleJobs += row.stale_count
      sourceBreakdown[row.source] = {
        count: row.count,
        stale_count: row.stale_count,
        latest_seen_at: row.latest_seen_at,
      }
    }

    const cacheRow = cacheStats.rows[0] || {}

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      providers: providersStatus,
      cache: {
        total_searches_cached: cacheRow.total_searches_cached || 0,
        fresh_entries: cacheRow.fresh_entries || 0,
        stale_entries: cacheRow.stale_entries || 0,
        latest_cache_update: cacheRow.latest_cache_update || null,
      },
      stored_jobs: {
        total_stored: totalStoredJobs,
        total_stale: totalStaleJobs,
        by_source: sourceBreakdown,
      },
      policies: {
        adzuna: getProviderPolicy('adzuna'),
        arbeitnow: getProviderPolicy('arbeitnow'),
        jooble: getProviderPolicy('jooble'),
      },
    }
  }
}

export const externalJobRefreshService = new ExternalJobRefreshService()

