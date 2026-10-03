/**
 * TechNova Job Application Assistant
 * External Job Provider Test Suite
 * Fully mocked - consumes ZERO real external API quotas.
 */

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { describe, it } from 'node:test'
import { createApp } from '../../app.js'
import { AdzunaJobProvider } from './providers/adzunaJobProvider.js'
import { ArbeitnowJobProvider } from './providers/arbeitnowJobProvider.js'
import { JoobleJobProvider } from './providers/joobleJobProvider.js'
import { ExternalJobService } from './externalJobService.js'
import { createNormalizedJob, parseSalaryFromText, stripHtml } from './normalizedJob.js'

describe('External Job Provider Architecture & Adapters', () => {
  describe('Normalized Job Contract & Utilities', () => {
    it('strips HTML and unescapes entities properly', () => {
      const raw = '<p>Looking for a <strong>Senior</strong> React &amp; Node.js dev &lt;awesome&gt;</p>'
      assert.equal(stripHtml(raw), 'Looking for a Senior React & Node.js dev <awesome>')
    })

    it('parses salary from free-form text correctly', () => {
      assert.deepEqual(parseSalaryFromText('$120,000 - $150,000 a year'), {
        salary_min: 120000,
        salary_max: 150000,
        currency: 'USD',
      })
      assert.deepEqual(parseSalaryFromText('£65,000 per annum'), {
        salary_min: 65000,
        salary_max: null,
        currency: 'GBP',
      })
      assert.deepEqual(parseSalaryFromText('Competitive'), {
        salary_min: null,
        salary_max: null,
        currency: null,
      })
    })

    it('enforces required fields and strips any credential keys from metadata', () => {
      const normalized = createNormalizedJob({
        source: 'test_provider',
        external_id: 'job-123',
        title: 'Software Engineer',
        company: 'Acme Corp',
        source_url: 'https://example.com/job/123',
        metadata: {
          app_id: 'secret_app_id',
          app_key: 'secret_app_key',
          api_key: 'secret_api_key',
          custom_tag: 'engineering',
        },
      })

      assert.equal(normalized.source, 'test_provider')
      assert.equal(normalized.external_id, 'job-123')
      assert.equal(normalized.metadata.custom_tag, 'engineering')
      assert.equal(normalized.metadata.app_id, undefined)
      assert.equal(normalized.metadata.app_key, undefined)
      assert.equal(normalized.metadata.api_key, undefined)
    })
  })

  describe('Adzuna Job Provider Adapter', () => {
    it('reports not configured if credentials missing', () => {
      const provider = new AdzunaJobProvider({ appId: null, appKey: null })
      assert.equal(provider.isConfigured(), false)
    })

    it('normalizes Adzuna response and preserves attribution', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          count: 142,
          results: [
            {
              id: '987654',
              title: '<strong>Senior</strong> Frontend Engineer',
              company: { display_name: 'Stripe Inc' },
              location: { display_name: 'San Francisco, CA', area: ['US', 'California'] },
              description: 'We are hiring a senior frontend developer...',
              contract_time: 'full_time',
              salary_min: 140000,
              salary_max: 180000,
              salary_is_predicted: 0,
              category: { tag: 'it-jobs', label: 'IT Jobs' },
              created: '2026-09-25T12:00:00Z',
              redirect_url: 'https://www.adzuna.com/land/ad/987654',
            },
          ],
        }),
      })

      const provider = new AdzunaJobProvider({ appId: 'test_id', appKey: 'test_key' })
      const result = await provider.searchJobs({
        keywords: 'Frontend',
        location: 'San Francisco',
        fetchImpl: mockFetch,
      })

      assert.equal(result.total, 142)
      assert.equal(result.jobs.length, 1)
      const job = result.jobs[0]
      assert.equal(job.source, 'adzuna')
      assert.equal(job.external_id, '987654')
      assert.equal(job.title, 'Senior Frontend Engineer')
      assert.equal(job.company, 'Stripe Inc')
      assert.equal(job.salary_min, 140000)
      assert.equal(job.salary_max, 180000)
      assert.equal(job.currency, 'USD')
      assert.equal(job.employment_type, 'full-time')
      assert.equal(result.attribution.name, 'Adzuna')
    })

    it('handles Adzuna non-2xx status safely', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 401,
      })

      const provider = new AdzunaJobProvider({ appId: 'test_id', appKey: 'test_key' })
      await assert.rejects(
        () => provider.searchJobs({ fetchImpl: mockFetch }),
        /Adzuna authentication failed/,
      )
    })

    it('handles Adzuna rate limit 429 response safely', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 429,
      })

      const provider = new AdzunaJobProvider({ appId: 'test_id', appKey: 'test_key' })
      await assert.rejects(
        () => provider.searchJobs({ fetchImpl: mockFetch }),
        /Adzuna rate limit exceeded/,
      )
    })

    it('handles Adzuna timeout gracefully', async () => {
      const mockFetch = async () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        throw error
      }

      const provider = new AdzunaJobProvider({ appId: 'test_id', appKey: 'test_key' })
      await assert.rejects(
        () => provider.searchJobs({ fetchImpl: mockFetch }),
        /timed out/,
      )
    })
  })

  describe('Arbeitnow Job Provider Adapter', () => {
    it('is always configured and normalizes public Arbeitnow responses', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              slug: 'full-stack-engineer-berlin-123',
              company_name: 'SoundCloud',
              title: 'Full Stack Engineer',
              description: '<p>Build the future of audio.</p>',
              remote: true,
              url: 'https://www.arbeitnow.com/jobs/companies/soundcloud/full-stack-engineer-123',
              tags: ['Node.js', 'React', 'Audio'],
              job_types: ['full_time'],
              location: 'Berlin, Germany',
              created_at: 1695600000,
            },
          ],
          meta: { total: 85 },
        }),
      })

      const provider = new ArbeitnowJobProvider()
      assert.equal(provider.isConfigured(), true)

      const result = await provider.searchJobs({ keywords: 'Engineer', fetchImpl: mockFetch })
      assert.equal(result.total, 85)
      assert.equal(result.jobs.length, 1)
      const job = result.jobs[0]
      assert.equal(job.source, 'arbeitnow')
      assert.equal(job.external_id, 'full-stack-engineer-berlin-123')
      assert.equal(job.company, 'SoundCloud')
      assert.equal(job.remote_type, 'remote')
      assert.equal(job.employment_type, 'full-time')
      assert.ok(result.attribution.text.includes('Arbeitnow'))
    })

    it('handles Arbeitnow malformed / empty response safely', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      })

      const provider = new ArbeitnowJobProvider()
      const result = await provider.searchJobs({ fetchImpl: mockFetch })
      assert.equal(result.jobs.length, 0)
      assert.equal(result.total, 0)
    })
  })

  describe('Jooble Job Provider Adapter', () => {
    it('reports not configured if JOOBLE_API_KEY is missing', () => {
      const provider = new JoobleJobProvider({ apiKey: null })
      assert.equal(provider.isConfigured(), false)
    })

    it('sends POST request and normalizes Jooble job response', async () => {
      let capturedMethod = ''
      let capturedBody = ''

      const mockFetch = async (_url, options) => {
        capturedMethod = options.method
        capturedBody = JSON.parse(options.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            totalCount: 310,
            jobs: [
              {
                id: 'jooble-554433',
                title: 'Remote Backend Engineer',
                company: 'Vercel',
                location: 'Remote',
                snippet: 'Work on edge runtime infrastructure...',
                salary: '$130,000 - $160,000',
                type: 'Full-time',
                link: 'https://jooble.org/desc/jooble-554433',
                updated: '2026-09-28T00:00:00Z',
              },
            ],
          }),
        }
      }

      const provider = new JoobleJobProvider({ apiKey: 'mock_jooble_key' })
      assert.equal(provider.isConfigured(), true)

      const result = await provider.searchJobs({
        keywords: 'Backend',
        location: 'Remote',
        fetchImpl: mockFetch,
      })

      assert.equal(capturedMethod, 'POST')
      assert.equal(capturedBody.keywords, 'Backend')
      assert.equal(result.total, 310)
      const job = result.jobs[0]
      assert.equal(job.source, 'jooble')
      assert.equal(job.company, 'Vercel')
      assert.equal(job.remote_type, 'remote')
      assert.equal(job.salary_min, 130000)
      assert.equal(job.salary_max, 160000)
    })

    it('handles Jooble 429 quota exhaustion safely', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 429,
      })

      const provider = new JoobleJobProvider({ apiKey: 'mock_jooble_key' })
      await assert.rejects(
        () => provider.searchJobs({ fetchImpl: mockFetch }),
        /Jooble rate limit exceeded or quota exhausted/,
      )
    })
  })

  describe('ExternalJobService Failure Isolation & Filtering', () => {
    it('isolates failures: one provider 500 error does not crash the search or affect other providers', async () => {
      const failingAdzuna = new AdzunaJobProvider({ appId: 'id', appKey: 'key' })
      failingAdzuna.searchJobs = async () => {
        throw new Error('Adzuna gateway timeout')
      }

      const workingArbeitnow = new ArbeitnowJobProvider()
      workingArbeitnow.searchJobs = async () => ({
        jobs: [
          createNormalizedJob({
            source: 'arbeitnow',
            external_id: 'arb-1',
            title: 'Frontend Developer',
            company: 'Design Co',
            source_url: 'https://example.com/job/1',
          }),
        ],
        total: 1,
        attribution: workingArbeitnow.getAttribution(),
      })

      const service = new ExternalJobService({
        providers: [failingAdzuna, workingArbeitnow],
      })

      const response = await service.searchJobs({ keywords: 'developer' })

      assert.equal(response.ok, true)
      assert.equal(response.total_results, 1)
      assert.equal(response.source_results.length, 2)

      const adzunaResult = response.source_results.find((r) => r.source === 'adzuna')
      const arbeitnowResult = response.source_results.find((r) => r.source === 'arbeitnow')

      assert.equal(adzunaResult.status, 'error')
      assert.equal(adzunaResult.message, 'Adzuna gateway timeout')
      assert.equal(adzunaResult.jobs.length, 0)

      assert.equal(arbeitnowResult.status, 'success')
      assert.equal(arbeitnowResult.jobs.length, 1)
    })

    it('filters search by specific source when requested', async () => {
      const adzuna = new AdzunaJobProvider({ appId: 'id', appKey: 'key' })
      let adzunaQueried = false
      adzuna.searchJobs = async () => {
        adzunaQueried = true
        return { jobs: [], total: 0, attribution: adzuna.getAttribution() }
      }

      const arbeitnow = new ArbeitnowJobProvider()
      let arbeitnowQueried = false
      arbeitnow.searchJobs = async () => {
        arbeitnowQueried = true
        return {
          jobs: [
            createNormalizedJob({
              source: 'arbeitnow',
              external_id: 'arb-9',
              title: 'Rust Engineer',
              company: 'Kernel Corp',
              source_url: 'https://example.com/job/9',
            }),
          ],
          total: 1,
          attribution: arbeitnow.getAttribution(),
        }
      }

      const service = new ExternalJobService({
        providers: [adzuna, arbeitnow],
      })

      const response = await service.searchJobs({ source: 'arbeitnow' })
      assert.equal(response.ok, true)
      assert.equal(adzunaQueried, false)
      assert.equal(arbeitnowQueried, true)
      assert.equal(response.source_results.length, 1)
      assert.equal(response.source_results[0].source, 'arbeitnow')
    })
  })

  describe('External Jobs API Endpoints', () => {
    async function makeRequest(baseUrl, path) {
      return fetch(`${baseUrl}${path}`)
    }

    it('GET /api/jobs/external/providers and GET /api/jobs/external/search operate correctly', async () => {
      const app = createApp()
      const server = app.listen(0)
      await once(server, 'listening')
      const port = server.address().port
      const baseUrl = `http://127.0.0.1:${port}`

      try {
        // Test providers status
        const provRes = await makeRequest(baseUrl, '/api/jobs/external/providers')
        assert.equal(provRes.status, 200)
        const provBody = await provRes.json()
        assert.equal(provBody.ok, true)
        assert.ok(provBody.providers.arbeitnow)
        assert.equal(provBody.providers.arbeitnow.configured, true)

        // Test bad page
        const badPageRes = await makeRequest(baseUrl, '/api/jobs/external/search?page=-1')
        assert.equal(badPageRes.status, 400)
        const badPageBody = await badPageRes.json()
        assert.ok(badPageBody.error.includes('page'))

        // Test bad limit
        const badLimitRes = await makeRequest(baseUrl, '/api/jobs/external/search?results_per_page=999')
        assert.equal(badLimitRes.status, 400)
        const badLimitBody = await badLimitRes.json()
        assert.ok(badLimitBody.error.includes('results_per_page'))

        // Test bad source
        const badSourceRes = await makeRequest(baseUrl, '/api/jobs/external/search?source=unknown_board')
        assert.equal(badSourceRes.status, 400)
        const badSourceBody = await badSourceRes.json()
        assert.ok(badSourceBody.error.includes('Invalid source'))

        // Test valid search (will query configured providers; unconfigured ones return status: unconfigured)
        const searchRes = await makeRequest(baseUrl, '/api/jobs/external/search?keywords=engineer&page=1&results_per_page=10')
        assert.equal(searchRes.status, 200)
        const searchBody = await searchRes.json()
        assert.equal(searchBody.ok, true)
        assert.ok(Array.isArray(searchBody.source_results))
        assert.ok(typeof searchBody.total_results === 'number')
        assert.ok(searchBody.providers)
      } finally {
        server.close()
        await once(server, 'close')
      }
    })
  })
})
