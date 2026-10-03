/**
 * TechNova Job Application Assistant
 * Step 11.3 — Unified Job Discovery & Search Test Suite
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../../db.js'
import { fromInternalJob, fromExternalJob } from './unifiedJobAdapter.js'
import { JobDiscoveryService } from './jobDiscoveryService.js'
import { scoreJob } from '../matchJobs.js'

test('Step 11.3 — Unified Job Search & Feed Merge', async (t) => {
  // Test Mock Data
  const sampleInternalJobs = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      created_by_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      company: 'TechNova Global',
      title: 'Senior Frontend Engineer',
      location: 'Bengaluru, India',
      remote_type: 'hybrid',
      employment_type: 'full-time',
      industry: 'Technology',
      description: 'Lead modern React frontend architecture.',
      source_url: 'https://technova.io/careers/senior-fe',
      salary_min: 1800000,
      salary_max: 2500000,
      currency: 'INR',
      status: 'open',
      posted_at: '2026-10-02',
      created_at: '2026-10-02T10:00:00Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      created_by_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      company: 'DataCore Labs',
      title: 'Backend Python Engineer',
      location: 'Hyderabad, India',
      remote_type: 'remote',
      employment_type: 'full-time',
      industry: 'Software',
      description: 'Build high throughput distributed APIs.',
      source_url: '',
      salary_min: 1500000,
      salary_max: 2200000,
      currency: 'INR',
      status: 'open',
      posted_at: '2026-10-01',
      created_at: '2026-10-01T10:00:00Z',
    },
  ]

  const sampleExternalJobs = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      source: 'adzuna',
      external_id: 'adzuna-99901',
      title: 'Frontend React Developer',
      company: 'Infosys Ltd',
      location: 'Delhi, India',
      country: 'in',
      is_remote: false,
      remote_type: 'onsite',
      employment_type: 'full_time',
      salary_min: 1200000,
      salary_max: 1600000,
      salary_currency: 'INR',
      description_snippet: 'Develop responsive React web applications.',
      apply_url: 'https://adzuna.com/land/ad/adzuna-99901',
      source_url: 'https://adzuna.com/details/adzuna-99901',
      attribution_text: 'Jobs powered by Adzuna',
      posted_at: '2026-10-02T14:00:00Z',
    },
    {
      // Duplicate of TechNova internal job to test deduplication
      id: '44444444-4444-4444-8444-444444444444',
      source: 'jooble',
      external_id: 'jooble-55502',
      title: 'Senior Frontend Engineer',
      company: 'TechNova Global Inc',
      location: 'Bengaluru, India',
      country: 'in',
      is_remote: false,
      remote_type: 'hybrid',
      employment_type: 'full-time',
      salary_min: 1800000,
      salary_max: 2500000,
      salary_currency: 'INR',
      description_snippet: 'Lead modern React frontend architecture.',
      apply_url: 'https://jooble.org/desc/55502',
      source_url: 'https://jooble.org/desc/55502',
      attribution_text: 'Jobs provided by Jooble',
      posted_at: '2026-10-02T12:00:00Z',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      source: 'arbeitnow',
      external_id: 'arbeitnow-33301',
      title: 'Full Stack Node / React Engineer',
      company: 'Spotify',
      location: 'Remote',
      country: 'in',
      is_remote: true,
      remote_type: 'remote',
      employment_type: 'contract',
      salary_min: 2000000,
      salary_max: 3000000,
      salary_currency: 'INR',
      description_snippet: 'Build scalable media services.',
      apply_url: 'https://arbeitnow.com/jobs/spotify-33301',
      source_url: 'https://arbeitnow.com/jobs/spotify-33301',
      attribution_text: 'Jobs powered by Arbeitnow',
      posted_at: '2026-10-03T01:00:00Z',
    },
  ]

  // Mock DB Pool
  const mockDbPool = {
    async query(sql, values = []) {
      if (sql.includes('FROM jobs')) {
        return { rows: sampleInternalJobs }
      }
      if (sql.includes('FROM job_preferences')) {
        return {
          rows: [
            {
              user_id: values[0],
              target_roles: ['Frontend Developer', 'Senior Frontend Engineer', 'React Engineer'],
              locations: ['Bengaluru, India', 'Remote'],
              remote_preference: 'any',
              min_salary: 1500000,
              max_salary: 3000000,
              employment_types: ['full-time', 'contract'],
              industries: ['Technology'],
            },
          ],
        }
      }
      return { rows: [] }
    },
  }

  // Mock External Ingestion Service
  const mockExternalIngestion = {
    async searchWithCache({ source = 'all' } = {}) {
      let jobs = sampleExternalJobs
      if (source !== 'all') {
        jobs = sampleExternalJobs.filter((j) => j.source === source)
      }
      return {
        ok: true,
        source_results: [
          {
            source: 'adzuna',
            configured: true,
            status: 'success',
            count: jobs.filter((j) => j.source === 'adzuna').length,
            jobs: jobs.filter((j) => j.source === 'adzuna'),
          },
          {
            source: 'jooble',
            configured: true,
            status: 'success',
            count: jobs.filter((j) => j.source === 'jooble').length,
            jobs: jobs.filter((j) => j.source === 'jooble'),
          },
          {
            source: 'arbeitnow',
            configured: true,
            status: 'success',
            count: jobs.filter((j) => j.source === 'arbeitnow').length,
            jobs: jobs.filter((j) => j.source === 'arbeitnow'),
          },
        ],
        providers: {
          adzuna: { configured: true, status: 'success' },
          jooble: { configured: true, status: 'success' },
          arbeitnow: { configured: true, status: 'success' },
        },
      }
    },
  }

  const service = new JobDiscoveryService({
    dbPool: mockDbPool,
    externalIngestion: mockExternalIngestion,
    scorer: scoreJob,
  })

  await t.test('1. Unified Job Adapter', async (t2) => {
    await t2.test('formats internal job with CareerStudio attribution and internal flag', () => {
      const internal = fromInternalJob(sampleInternalJobs[0])
      assert.equal(internal.source_type, 'internal')
      assert.equal(internal.source, 'internal')
      assert.equal(internal.is_external, false)
      assert.equal(internal.attribution, 'CareerStudio Recruiter Verified')
      assert.equal(internal.created_by_user_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    })

    await t2.test('formats external job with provider attribution and no user owner', () => {
      const ext = fromExternalJob(sampleExternalJobs[0])
      assert.equal(ext.source_type, 'external')
      assert.equal(ext.source, 'adzuna')
      assert.equal(ext.is_external, true)
      assert.equal(ext.attribution, 'Jobs powered by Adzuna')
      assert.equal(ext.created_by_user_id, null)
      assert.equal(ext.apply_url, 'https://adzuna.com/land/ad/adzuna-99901')
    })
  })

  await t.test('2. Unified Search & Cross-Source Deduplication', async (t2) => {
    await t2.test('merges internal and external jobs and eliminates cross-source duplicates', async () => {
      const result = await service.searchUnified({
        source: 'all',
        country: 'in',
        page: 1,
        results_per_page: 20,
      })

      assert.equal(result.ok, true)
      assert.ok(Array.isArray(result.jobs))
      // Total raw = 2 internal + 3 external = 5.
      // jooble-55502 duplicates TechNova Senior Frontend Engineer, so total unique should be 4.
      assert.equal(result.pagination.total_results, 4)
      assert.equal(result.jobs.length, 4)

      // Verify TechNova internal job took precedence over the Jooble copy
      const technovaJob = result.jobs.find((j) => j.company.toLowerCase().includes('technova'))
      assert.ok(technovaJob)
      assert.equal(technovaJob.source_type, 'internal')
      assert.equal(technovaJob.source, 'internal')
    })

    await t2.test('filters by source correctly when source=internal', async () => {
      const result = await service.searchUnified({ source: 'internal' })
      assert.equal(result.ok, true)
      assert.ok(result.jobs.every((j) => j.source_type === 'internal'))
      assert.equal(result.jobs.length, 2)
    })

    await t2.test('filters by source correctly when source=adzuna', async () => {
      const result = await service.searchUnified({ source: 'adzuna' })
      assert.equal(result.ok, true)
      assert.ok(result.jobs.every((j) => j.source === 'adzuna'))
      assert.equal(result.jobs.length, 1)
      assert.equal(result.jobs[0].company, 'Infosys Ltd')
    })
  })

  await t.test('3. Deterministic Match Scoring for Authenticated Seekers', async (t2) => {
    await t2.test('calculates deterministic scores for internal and external jobs', async () => {
      const user = { id: 'user-seeker-777' }
      const result = await service.searchUnified({
        user,
        source: 'all',
        sort: 'best_match',
      })

      assert.equal(result.ok, true)
      assert.ok(result.jobs.length > 0)

      for (const job of result.jobs) {
        assert.ok(typeof job.match_score === 'number', `job ${job.title} should have match_score`)
        assert.ok(job.match_breakdown, `job ${job.title} should have match_breakdown`)
        assert.ok(typeof job.match_breakdown.role === 'number')
        assert.ok(typeof job.match_breakdown.location === 'number')
      }

      // Best match sort check: highest score first
      for (let i = 0; i < result.jobs.length - 1; i++) {
        assert.ok(
          result.jobs[i].match_score >= result.jobs[i + 1].match_score,
          `Index ${i} (${result.jobs[i].match_score}) should be >= Index ${i + 1} (${result.jobs[i + 1].match_score})`,
        )
      }
    })

    await t2.test('unauthenticated users receive null match scores without crashing', async () => {
      const result = await service.searchUnified({ user: null })
      assert.equal(result.ok, true)
      for (const job of result.jobs) {
        assert.equal(job.match_score, null)
        assert.equal(job.match_breakdown, null)
      }
    })
  })

  await t.test('4. Server-Side Pagination', async (t2) => {
    await t2.test('returns exact page slice, total pages, has_next, and has_prev', async () => {
      const page1 = await service.searchUnified({ page: 1, results_per_page: 2 })
      assert.equal(page1.pagination.page, 1)
      assert.equal(page1.pagination.results_per_page, 2)
      assert.equal(page1.pagination.total_results, 4)
      assert.equal(page1.pagination.total_pages, 2)
      assert.equal(page1.pagination.has_next, true)
      assert.equal(page1.pagination.has_prev, false)
      assert.equal(page1.jobs.length, 2)

      const page2 = await service.searchUnified({ page: 2, results_per_page: 2 })
      assert.equal(page2.pagination.page, 2)
      assert.equal(page2.pagination.has_next, false)
      assert.equal(page2.pagination.has_prev, true)
      assert.equal(page2.jobs.length, 2)
      assert.notEqual(page1.jobs[0].id, page2.jobs[0].id)
    })
  })

  await t.test('5. Failure Resilience & Fault Tolerance', async (t2) => {
    await t2.test('internal jobs continue serving when external provider throws an error', async () => {
      const failingExternalIngestion = {
        async searchWithCache() {
          throw new Error('503 Service Unavailable from external aggregators')
        },
      }
      const resilientService = new JobDiscoveryService({
        dbPool: mockDbPool,
        externalIngestion: failingExternalIngestion,
        scorer: scoreJob,
      })

      const result = await resilientService.searchUnified({ source: 'all' })
      assert.equal(result.ok, true)
      assert.equal(result.jobs.length, 2)
      assert.ok(result.jobs.every((j) => j.source_type === 'internal'))
    })
  })

  await t.test('6. Security & Authorization Integrity', async (t2) => {
    await t2.test('external jobs never have internal recruiter user IDs', async () => {
      const result = await service.searchUnified({ source: 'all' })
      const externalOnly = result.jobs.filter((j) => j.is_external)
      assert.ok(externalOnly.length > 0)
      for (const extJob of externalOnly) {
        assert.equal(extJob.created_by_user_id, null)
        assert.ok(extJob.apply_url.startsWith('https://'))
        assert.ok(extJob.attribution.length > 0)
      }
    })
  })
})
