/**
 * TechNova Job Application Assistant
 * Step 11.5 — External Job Feed Automation & Reliability Test Suite
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { ExternalJobRefreshService } from './externalJobRefreshService.js'

class MockProvider {
  constructor({ name = 'mock_provider', configured = true, jobs = [], error = null } = {}) {
    this.name = name
    this.configured = configured
    this.jobs = jobs
    this.error = error
  }

  getName() {
    return this.name
  }

  isConfigured() {
    return this.configured
  }

  getAttribution() {
    return { text: `Jobs from ${this.name}`, url: `https://${this.name}.example.com` }
  }

  async searchJobs() {
    if (this.error) throw new Error(this.error)
    return {
      jobs: this.jobs,
      total: this.jobs.length,
      attribution: this.getAttribution(),
    }
  }
}

test('Step 11.5 — External Job Refresh Service Unit Tests', async (t) => {
  await t.test('1. Unconfigured provider reports unconfigured status safely', async () => {
    const mockUnconf = new MockProvider({ name: 'unconf_prov', configured: false })
    const mockJobService = {
      providers: new Map([['unconf_prov', mockUnconf]]),
      getProvider: (name) => (name === 'unconf_prov' ? mockUnconf : null),
    }

    const refreshService = new ExternalJobRefreshService({
      jobService: mockJobService,
      cache: { get: async () => ({ isHit: false }) },
    })

    const result = await refreshService.refreshExternalJobs({ providers: ['unconf_prov'] })
    assert.equal(result.ok, true)
    assert.equal(result.providers.unconf_prov.status, 'unconfigured')
    assert.equal(result.providers.unconf_prov.configured, false)
  })

  await t.test('2. Provider failure is isolated without crashing the refresh pipeline', async () => {
    const failingProv = new MockProvider({ name: 'failing_prov', configured: true, error: 'Network timeout 504' })
    const workingProv = new MockProvider({
      name: 'working_prov',
      configured: true,
      jobs: [
        {
          source: 'working_prov',
          external_id: 'job-101',
          title: 'Senior Node Developer',
          company: 'Acme',
          location: 'Bengaluru',
          description: 'Build backend APIs',
          source_url: 'https://example.com/job-101',
          canonical_url: 'https://example.com/job-101',
        },
      ],
    })

    const mockJobService = {
      providers: new Map([
        ['failing_prov', failingProv],
        ['working_prov', workingProv],
      ]),
      getProvider: (name) => (name === 'failing_prov' ? failingProv : name === 'working_prov' ? workingProv : null),
    }

    const mockIngestion = {
      ingestNormalizedBatch: async (jobs) => ({
        upserted: jobs.map((j, i) => ({ id: `upserted-${i}`, ...j })),
        deduplicatedCount: 0,
      }),
    }

    const mockCache = {
      get: async () => ({ isHit: false }),
      set: async () => true,
    }

    const refreshService = new ExternalJobRefreshService({
      jobService: mockJobService,
      ingestionService: mockIngestion,
      cache: mockCache,
    })

    const result = await refreshService.refreshExternalJobs({ providers: ['failing_prov', 'working_prov'] })
    assert.equal(result.ok, true)
    assert.equal(result.providers.failing_prov.status, 'failed')
    assert.ok(result.providers.failing_prov.message.includes('Network timeout'))
    assert.equal(result.providers.working_prov.status, 'success')
    assert.equal(result.providers.working_prov.count, 1)
  })
})
