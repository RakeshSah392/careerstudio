/**
 * TechNova Job Application Assistant
 * Step 12.1 — Job Match Explanation Service
 * Orchestrates deterministic match computation, prompt building, and local Ollama inference.
 */

import { pool } from '../../db.js'
import { applicationProfileService } from '../applicationProfileService.js'
import { scoreJob } from '../matchJobs.js'
import { JobMatchPromptBuilder } from './promptBuilder.js'
import { OllamaLLMProvider } from './providers/ollamaLLMProvider.js'
import { DisabledLLMProvider } from './aiContracts.js'
import { isUuid } from '../../lib/validation.js'
import { logger } from '../../lib/logger.js'

export class JobMatchExplanationService {
  constructor({
    dbPool = pool,
    profileService = applicationProfileService,
    scorer = scoreJob,
    llmProvider = null,
  } = {}) {
    this.pool = dbPool
    this.profileService = profileService
    this.scorer = scorer
    this.defaultProvider = llmProvider || (process.env.AI_PROVIDER === 'disabled'
      ? new DisabledLLMProvider()
      : new OllamaLLMProvider())
  }

  getProvider() {
    return this.defaultProvider
  }

  /**
   * Generates a factual, supplementary explanation for why a seeker matches a given job.
   * Authoritative deterministic match percentage is NEVER overwritten.
   *
   * @param {object} options
   * @param {string} options.userId - Authenticated user UUID
   * @param {string} options.jobId - Target job UUID
   * @param {object} [options.overrideProvider] - Injected provider for unit testing
   * @returns {Promise<object>}
   */
  async explainJobMatch({ userId, jobId, overrideProvider = null }) {
    if (!userId || !isUuid(userId)) {
      throw new Error('Valid user ID is required.')
    }
    if (!jobId) {
      throw new Error('Valid job ID is required.')
    }

    // 1. Fetch User Data (Profile, Preferences, Resume)
    const [profileData, prefResult, resumeResult] = await Promise.all([
      this.profileService.getProfileWithCompleteness(userId),
      this.pool.query('SELECT * FROM job_preferences WHERE user_id = $1 LIMIT 1', [userId]),
      this.pool.query(
        'SELECT id, title, content_text, is_primary FROM resumes WHERE user_id = $1 AND is_primary = true LIMIT 1',
        [userId],
      ),
    ])

    const profile = profileData.profile || {}
    const preferences = prefResult.rows[0] || {}
    const primaryResume = resumeResult.rows[0] || profileData.primaryResume || null
    const resumeText = primaryResume?.content_text || ''

    // 2. Fetch Job Details (check internal recruiter jobs first, then external jobs table)
    let job = null
    if (isUuid(jobId)) {
      const internalJobRes = await this.pool.query(
        'SELECT id, company, title, location, remote_type, employment_type, industry, description, salary_min, salary_max, currency, status FROM jobs WHERE id = $1',
        [jobId],
      )
      if (internalJobRes.rowCount) {
        job = internalJobRes.rows[0]
      }
    }

    if (!job) {
      const externalJobRes = await this.pool.query(
        'SELECT id, company, title, location, remote_type, employment_type, description, salary_min, salary_max, currency, source_url FROM external_jobs WHERE id = $1',
        [jobId],
      )
      if (externalJobRes.rowCount) {
        job = externalJobRes.rows[0]
      }
    }

    if (!job) {
      const err = new Error('Job not found.')
      err.status = 404
      throw err
    }

    // 3. Compute Deterministic Match Score & Breakdown (Authoritative)
    const matchScore = this.scorer(job, preferences, profile)

    // Build sub-score breakdown deterministically
    const userRoles = Array.isArray(preferences.target_roles) ? preferences.target_roles : []
    const roleMatch = userRoles.some((r) => String(job.title).toLowerCase().includes(String(r).toLowerCase())) ? 100 : 50
    const profileSkills = Array.isArray(profile.skills) ? profile.skills : []
    const matchingSkills = profileSkills.filter((s) => String(job.description || '').toLowerCase().includes(String(s).toLowerCase()))
    const skillsMatch = profileSkills.length > 0 ? Math.round((matchingSkills.length / Math.max(1, profileSkills.length)) * 100) : 50
    const expMatch = profile.years_of_experience != null ? 80 : 50
    const locMatch = (preferences.remote_preference === 'any' || String(job.remote_type).toLowerCase() === String(preferences.remote_preference).toLowerCase()) ? 100 : 60

    const matchBreakdown = {
      role: roleMatch,
      skills: skillsMatch,
      experience: expMatch,
      location: locMatch,
    }

    // 4. Build Prompt
    const promptPayload = JobMatchPromptBuilder.buildExplanationPrompt({
      job,
      candidateProfile: profile,
      resumeText,
      matchScore,
      matchBreakdown,
    })

    const provider = overrideProvider || this.defaultProvider

    // 5. Query Local LLM Provider
    try {
      const result = await provider.generateAnswer({
        prompt: promptPayload.prompt,
        systemInstruction: promptPayload.systemInstruction,
        context: promptPayload.context,
        format: 'json',
        temperature: 0.2,
      })

      const parsedExplanation = JobMatchPromptBuilder.parseExplanationResponse(result.text)

      return {
        ok: true,
        job_id: jobId,
        deterministic_match: {
          score: matchScore,
          breakdown: matchBreakdown,
        },
        explanation: parsedExplanation,
        model: result.model || 'qwen2.5:1.5b',
        provider: typeof provider.getName === 'function' ? provider.getName() : 'ollama',
        usage: result.usage || null,
      }
    } catch (llmErr) {
      logger.warn('Local LLM Match Explanation unavailable', {
        jobId,
        userId,
        error: llmErr.message,
      })

      return {
        ok: false,
        code: 'AI_UNAVAILABLE',
        message: 'Local AI service is currently unavailable. Ensure Ollama is running.',
        deterministic_match: {
          score: matchScore,
          breakdown: matchBreakdown,
        },
        explanation: null,
      }
    }
  }
}

export const jobMatchExplanationService = new JobMatchExplanationService()
