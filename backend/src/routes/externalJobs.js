/**
 * TechNova Job Application Assistant
 * External Job Search API Route
 */

import { Router } from 'express'
import { externalJobService } from '../services/externalJobs/externalJobService.js'
import { optionalAuth } from '../middleware/requireAuth.js'

const router = Router()

const validSources = ['all', 'adzuna', 'arbeitnow', 'jooble']

function validateSearchParams(query) {
  const { keywords, location, page, results_per_page, source, country } = query

  if (keywords !== undefined && typeof keywords !== 'string') {
    return 'keywords must be text.'
  }
  if (keywords && keywords.length > 150) {
    return 'keywords cannot exceed 150 characters.'
  }

  if (location !== undefined && typeof location !== 'string') {
    return 'location must be text.'
  }
  if (location && location.length > 100) {
    return 'location cannot exceed 100 characters.'
  }

  if (page !== undefined) {
    const p = Number(page)
    if (!Number.isInteger(p) || p < 1 || p > 100) {
      return 'page must be an integer between 1 and 100.'
    }
  }

  if (results_per_page !== undefined) {
    const limit = Number(results_per_page)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return 'results_per_page must be an integer between 1 and 50.'
    }
  }

  if (source !== undefined && !validSources.includes(String(source).toLowerCase())) {
    return `Invalid source "${source}". Allowed: ${validSources.join(', ')}.`
  }

  if (country !== undefined && (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country))) {
    return 'country must be a two-letter country code (e.g. us, gb, ca, in).'
  }

  return null
}

/**
 * GET /api/jobs/external/providers
 * Returns list and configuration status of all available external providers.
 */
router.get('/providers', optionalAuth, async (_request, response) => {
  const status = externalJobService.getProvidersStatus()
  response.json({ ok: true, providers: status })
})

/**
 * GET /api/jobs/external/search
 * Executes external search across configured job providers.
 */
router.get('/search', optionalAuth, async (request, response) => {
  const validationError = validateSearchParams(request.query)
  if (validationError) {
    return response.status(400).json({ error: validationError })
  }

  const {
    keywords = '',
    location = '',
    page = 1,
    results_per_page = 20,
    source = 'all',
    country = 'us',
  } = request.query

  try {
    const results = await externalJobService.searchJobs({
      keywords: String(keywords),
      location: String(location),
      page: Number(page) || 1,
      results_per_page: Number(results_per_page) || 20,
      source: String(source),
      country: String(country),
    })

    response.json(results)
  } catch (err) {
    response.status(400).json({ error: err.message || 'External job search failed.' })
  }
})

export default router
