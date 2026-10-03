/**
 * TechNova Job Application Assistant
 * External Job Provider Policies & Legal/Usage Capabilities
 */

export const PROVIDER_POLICIES = {
  adzuna: {
    name: 'Adzuna',
    canPersist: 'short_term_cache',
    cacheTtlSeconds: 3600, // 1 hour caching permitted to optimize request quotas
    retentionDays: 14,     // Mark stale if not observed in 14 days
    requiresAttribution: true,
    attribution: {
      name: 'Adzuna',
      text: 'Jobs powered by Adzuna',
      url: 'https://www.adzuna.com',
    },
    rateLimits: {
      defaultRequestsPerMinute: 25,
      defaultRequestsPerDay: 250,
      defaultRequestsPerMonth: 2500,
    },
    notes: 'Adzuna API terms require valid source attribution and data freshness; indefinite standalone storage is prohibited.',
  },
  arbeitnow: {
    name: 'Arbeitnow',
    canPersist: 'short_term_cache',
    cacheTtlSeconds: 3600, // 1 hour caching
    retentionDays: 14,
    requiresAttribution: true,
    attribution: {
      name: 'Arbeitnow',
      text: 'Jobs via Arbeitnow (https://www.arbeitnow.com)',
      url: 'https://www.arbeitnow.com',
    },
    rateLimits: {
      general: 'Free public API; requires backlink on job display',
    },
    notes: 'Arbeitnow requires direct backlink to listing or homepage on display.',
  },
  jooble: {
    name: 'Jooble',
    canPersist: 'short_term_cache',
    cacheTtlSeconds: 14400, // 4 hours caching to preserve 500-request lifetime key limit
    retentionDays: 14,
    requiresAttribution: true,
    attribution: {
      name: 'Jooble',
      text: 'Jobs powered by Jooble',
      url: 'https://jooble.org',
    },
    rateLimits: {
      freeTierLifetimeRequests: 500,
    },
    notes: 'Jooble free API has strict 500-request lifetime quota; aggressive caching is required.',
  },
}

export function getProviderPolicy(sourceName) {
  const key = String(sourceName || '').toLowerCase().trim()
  return PROVIDER_POLICIES[key] || {
    name: sourceName || 'Unknown Provider',
    canPersist: 'short_term_cache',
    cacheTtlSeconds: 1800, // 30 min conservative fallback
    retentionDays: 7,
    requiresAttribution: true,
    attribution: {
      name: sourceName || 'External Source',
      text: `Jobs provided by ${sourceName || 'external source'}`,
      url: '',
    },
    rateLimits: {},
    notes: 'Conservative fallback policy.',
  }
}
