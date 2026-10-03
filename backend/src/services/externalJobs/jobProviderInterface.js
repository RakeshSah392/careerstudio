/**
 * TechNova Job Application Assistant
 * Job Provider Contract (Neutral Interface)
 */

export class JobProviderInterface {
  /**
   * Unique machine-readable identifier for the provider (e.g. 'adzuna', 'arbeitnow', 'jooble')
   * @returns {string}
   */
  getName() {
    throw new Error('getName() must be implemented by provider adapter.')
  }

  /**
   * Returns whether this provider has all required API credentials/configuration present in the environment.
   * @returns {boolean}
   */
  isConfigured() {
    throw new Error('isConfigured() must be implemented by provider adapter.')
  }

  /**
   * Returns official legal attribution metadata for display (name, disclaimer text, official link).
   * @returns {{ name: string, text: string, url: string }}
   */
  getAttribution() {
    throw new Error('getAttribution() must be implemented by provider adapter.')
  }

  /**
   * Returns whether this provider supports the requested country.
   * Default is true unless restricted by the provider policy.
   * @param {string} [country='in']
   * @returns {boolean}
   */
  supportsCountry(_country = 'in') {
    return true
  }

  /**
   * Executes job search against the external provider and returns normalized results.
   * @param {object} params
   * @param {string} [params.keywords]
   * @param {string} [params.location]
   * @param {number} [params.page=1]
   * @param {number} [params.results_per_page=20]
   * @param {string} [params.country='us']
   * @param {number} [params.timeoutMs=7000]
   * @param {typeof fetch} [params.fetchImpl=globalThis.fetch]
   * @returns {Promise<{ jobs: Array<object>, total: number, attribution: object }>}
   */
  async searchJobs(_params = {}) {
    throw new Error('searchJobs() must be implemented by provider adapter.')
  }
}
