/**
 * TechNova Job Application Assistant
 * External Job Cache Interface Contract
 * Enables clean replacement or augmentation with Redis in the future without changing business services.
 */

export class ExternalJobCacheInterface {
  /**
   * Retrieves a cached search result entry.
   * @param {string} cacheKey 
   * @returns {Promise<{ isHit: boolean, isStale: boolean, entry: object|null }>}
   */
  async get(_cacheKey) {
    throw new Error('get() must be implemented by cache provider.')
  }

  /**
   * Sets or updates a cached search result entry.
   * @param {object} params
   * @param {string} params.cacheKey
   * @param {string} params.source
   * @param {object} params.queryParams
   * @param {Array<string>} params.resultJobIds
   * @param {number} params.totalAvailable
   * @param {object} params.attribution
   * @param {number} params.ttlSeconds
   * @returns {Promise<object>}
   */
  async set(_params) {
    throw new Error('set() must be implemented by cache provider.')
  }

  /**
   * Invalidates an explicit cache entry.
   * @param {string} cacheKey 
   * @returns {Promise<boolean>}
   */
  async invalidate(_cacheKey) {
    throw new Error('invalidate() must be implemented by cache provider.')
  }

  /**
   * Prunes expired cache records to bound database growth.
   * @returns {Promise<number>} Number of pruned records
   */
  async pruneExpired() {
    throw new Error('pruneExpired() must be implemented by cache provider.')
  }
}
