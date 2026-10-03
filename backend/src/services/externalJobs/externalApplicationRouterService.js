/**
 * TechNova Job Application Assistant
 * External Application Router & Standardized Export Service
 * Manages external job routing and creates provider-neutral candidate export payloads.
 */

import { pool } from '../../db.js'
import { applicationProfileService } from '../applicationProfileService.js'

export class ExternalApplicationRouterService {
  constructor({
    dbPool = pool,
    profileService = applicationProfileService,
  } = {}) {
    this.pool = dbPool
    this.profileService = profileService
  }

  /**
   * Builds a provider-neutral, sanitized candidate application export payload.
   * Strips all credentials, session tokens, and passwords.
   */
  async exportCandidatePayload(userId, targetJob = null) {
    if (!userId) throw new Error('User ID is required to export application payload.')

    const [userResult, profileResult, preferencesResult] = await Promise.all([
      this.pool.query('SELECT id, email, full_name FROM users WHERE id = $1', [userId]),
      this.profileService.getProfileWithCompleteness(userId),
      this.pool.query('SELECT * FROM job_preferences WHERE user_id = $1 LIMIT 1', [userId]),
    ])

    if (!userResult.rowCount) {
      const err = new Error('User not found.')
      err.status = 404
      throw err
    }

    const user = userResult.rows[0]
    const profile = profileResult.profile || {}
    const primaryResume = profileResult.primaryResume || null
    const preferences = preferencesResult.rows[0] || {}

    return {
      schema_version: '1.0.0',
      exported_at: new Date().toISOString(),
      candidate: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: profile.contact_phone || null,
        location: profile.location || null,
        headline: profile.headline || null,
        summary: profile.summary || null,
      },
      profile: {
        current_job_title: profile.current_job_title || null,
        years_of_experience: profile.years_of_experience ?? null,
        experience_level: profile.experience_level || null,
        skills: profile.skills || [],
        experience: profile.experience || [],
        education: profile.education || [],
        certifications: profile.certifications || [],
        portfolio_urls: profile.portfolio_urls || [],
        linkedin_url: profile.linkedin_url || null,
        github_url: profile.github_url || null,
      },
      resume: primaryResume
        ? {
            id: primaryResume.id,
            title: primaryResume.title,
            filename: primaryResume.source_filename || null,
            content_text: primaryResume.content_text || '',
            updated_at: primaryResume.updated_at,
          }
        : null,
      preferences: {
        target_roles: preferences.target_roles || [],
        locations: preferences.locations || [],
        remote_preference: preferences.remote_preference || 'any',
        expected_salary: profile.expected_salary ?? preferences.min_salary ?? null,
        salary_currency: profile.salary_currency || preferences.currency || 'INR',
      },
      common_answers: {
        authorized_to_work: profile.work_authorization_status || 'authorized',
        requires_sponsorship: profile.requires_sponsorship ?? false,
        notice_period_days: profile.notice_period_days ?? null,
        willing_to_relocate: profile.willing_to_relocate ?? false,
      },
      target_job: targetJob
        ? {
            id: targetJob.id,
            title: targetJob.title,
            company: targetJob.company,
            location: targetJob.location,
            source: targetJob.source || 'external',
            apply_url: targetJob.apply_url || targetJob.source_url || '',
          }
        : null,
    }
  }

  /**
   * Records candidate interest/open of an external job without creating a fake application.
   */
  async recordExternalClick({ userId = null, externalJobId = null, source = 'external', sourceUrl = '' }) {
    if (!sourceUrl) throw new Error('sourceUrl is required.')

    const result = await this.pool.query(
      `INSERT INTO external_application_clicks (user_id, external_job_id, source, source_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at, source, source_url`,
      [userId, externalJobId, source, sourceUrl],
    )

    return {
      ok: true,
      tracked: true,
      click_id: result.rows[0].id,
      source,
      source_url: sourceUrl,
      message: 'External application navigation recorded.',
    }
  }
}

export const externalApplicationRouterService = new ExternalApplicationRouterService()
