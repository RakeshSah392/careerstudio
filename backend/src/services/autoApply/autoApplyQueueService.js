/**
 * TechNova Job Application Assistant
 * Auto-Apply Queue & Processing Orchestrator
 * Coordinates eligibility checks, idempotent queue transitions, and safe application execution.
 */

import { pool } from '../../db.js'
import { autoApplyService } from '../autoApplyService.js'
import { autoApplyEligibilityService } from './eligibilityService.js'
import { autoApplyQueueRepository } from '../../repositories/autoApplyQueueRepository.js'
import { applicationProfileService } from '../applicationProfileService.js'
import { scoreJob } from '../matchJobs.js'
import { logger } from '../../lib/logger.js'

export class AutoApplyQueueService {
  constructor({
    dbPool = pool,
    settingsService = autoApplyService,
    eligibility = autoApplyEligibilityService,
    queueRepo = autoApplyQueueRepository,
    profileService = applicationProfileService,
    scorer = scoreJob,
  } = {}) {
    this.pool = dbPool
    this.settingsService = settingsService
    this.eligibility = eligibility
    this.queueRepo = queueRepo
    this.profileService = profileService
    this.scorer = scorer
  }

  /**
   * Retrieves overall Auto-Apply health and queue summary for a user.
   */
  async getStatus(userId) {
    const [settings, profileWithMeta, queueCounts] = await Promise.all([
      this.settingsService.getSettings(userId),
      this.profileService.getProfileWithCompleteness(userId),
      this.queueRepo.getQueueSummary(userId),
    ])

    return {
      ok: true,
      settings,
      profile: {
        isComplete: Boolean(profileWithMeta.completeness?.isComplete),
        completenessPercentage: profileWithMeta.completeness?.completenessScore || 0,
        hasPrimaryResume: Boolean(profileWithMeta.primaryResume),
        primaryResume: profileWithMeta.primaryResume || null,
      },
      queueSummary: queueCounts,
    }
  }

  /**
   * Returns paginated queue items for a candidate.
   */
  async getQueue(userId, { status = null, limit = 50 } = {}) {
    const items = await this.queueRepo.findByUserId(userId, { status, limit })
    return {
      ok: true,
      count: items.length,
      queue: items,
    }
  }

  /**
   * Evaluates all open internal jobs for a candidate against their Auto-Apply settings.
   */
  async evaluateOpenJobs(user) {
    if (!user?.id) throw new Error('User is required for evaluation.')

    const [settings, profileResult, preferencesResult, openJobsResult, userAppsResult] = await Promise.all([
      this.settingsService.getSettings(user.id),
      this.profileService.getProfileWithCompleteness(user.id),
      this.pool.query('SELECT * FROM job_preferences WHERE user_id = $1 LIMIT 1', [user.id]),
      this.pool.query("SELECT * FROM jobs WHERE status = 'open' ORDER BY posted_at DESC NULLS LAST, created_at DESC"),
      this.pool.query('SELECT job_id FROM applications WHERE user_id = $1 AND job_id IS NOT NULL', [user.id]),
    ])

    const appliedJobIds = new Set(userAppsResult.rows.map((r) => r.job_id))
    const preferences = preferencesResult.rows[0] || {}
    const evaluated = []

    for (const job of openJobsResult.rows) {
      const matchResult = this.scorer(job, preferences)
      const matchScore = matchResult.score

      const evalResult = this.eligibility.evaluate({
        user,
        profile: profileResult.profile,
        autoApplySettings: settings,
        primaryResume: profileResult.primaryResume,
        job,
        matchScore,
        alreadyApplied: appliedJobIds.has(job.id),
      })

      evaluated.push({
        job: {
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          remote_type: job.remote_type,
          salary_min: job.salary_min,
          salary_max: job.salary_max,
          currency: job.currency,
        },
        match_score: matchScore,
        match_breakdown: matchResult.score_breakdown,
        eligible: evalResult.eligible,
        reasons: evalResult.reasons,
        criteria: evalResult.criteria,
      })
    }

    return {
      ok: true,
      evaluated_count: evaluated.length,
      eligible_count: evaluated.filter((e) => e.eligible).length,
      jobs: evaluated,
    }
  }

  /**
   * Idempotently queues and executes application for an eligible internal job.
   * Disallows automated submission for external jobs.
   */
  async queueAndProcessJob({ user, jobId }) {
    if (!user?.id) {
      const err = new Error('Candidate authentication is required.')
      err.status = 401
      throw err
    }

    // 1. Fetch Job from database
    const jobResult = await this.pool.query('SELECT * FROM jobs WHERE id = $1', [jobId])
    if (!jobResult.rowCount) {
      const err = new Error('Job not found in internal listings.')
      err.status = 404
      throw err
    }
    const job = jobResult.rows[0]

    // 2. Fetch candidate prerequisites
    const [settings, profileResult, preferencesResult, existingAppResult, existingQueueResult] = await Promise.all([
      this.settingsService.getSettings(user.id),
      this.profileService.getProfileWithCompleteness(user.id),
      this.pool.query('SELECT * FROM job_preferences WHERE user_id = $1 LIMIT 1', [user.id]),
      this.pool.query('SELECT id, status FROM applications WHERE user_id = $1 AND job_id = $2 LIMIT 1', [user.id, jobId]),
      this.queueRepo.findByUserAndJob(user.id, jobId),
    ])

    // If already applied in queue and application exists, return existing state idempotently
    if (existingQueueResult?.status === 'applied' && existingAppResult.rowCount > 0) {
      return {
        ok: true,
        eligible: true,
        already_applied: true,
        queue_item: existingQueueResult,
        application_id: existingAppResult.rows[0].id,
      }
    }

    const preferences = preferencesResult.rows[0] || {}
    const matchResult = this.scorer(job, preferences)
    const matchScore = matchResult.score

    // 3. Evaluate strict eligibility
    const evalResult = this.eligibility.evaluate({
      user,
      profile: profileResult.profile,
      autoApplySettings: settings,
      primaryResume: profileResult.primaryResume,
      job,
      matchScore,
      alreadyApplied: existingAppResult.rowCount > 0,
    })

    if (!evalResult.eligible) {
      // Record blocked/failed queue item
      const failureReason = evalResult.reasons.join('; ')
      const queueItem = await this.queueRepo.upsertQueueItem({
        userId: user.id,
        jobId,
        jobSource: 'internal',
        status: 'blocked',
        matchScore,
        failureReason,
      })

      return {
        ok: false,
        eligible: false,
        reasons: evalResult.reasons,
        queue_item: queueItem,
      }
    }

    // 4. Safe Idempotent Execution: Transition through queued -> processing -> applied
    const queueItem = await this.queueRepo.upsertQueueItem({
      userId: user.id,
      jobId,
      jobSource: 'internal',
      status: 'processing',
      matchScore,
      failureReason: null,
    })

    try {
      // Create Application in normal applications table with source = 'auto_apply'
      const appInsertResult = await this.pool.query(
        `INSERT INTO applications (
          user_id, job_id, company, role, location, source_url, status, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, user_id, job_id, company, role, location, source_url, status, applied_at, source`,
        [
          user.id,
          jobId,
          job.company,
          job.title,
          job.location || '',
          job.source_url || '',
          'Applied',
          'auto_apply',
        ],
      )

      const application = appInsertResult.rows[0]

      // Notify recruiter if recruiter user exists
      if (job.created_by_user_id) {
        const applicantName = user.full_name || 'A verified candidate'
        await this.pool.query(
          `INSERT INTO notifications (user_id, type, title, message, related_job_id, related_application_id, is_read, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
          [
            job.created_by_user_id,
            'new_application',
            'New Auto-Applied candidate',
            `${applicantName} matched (${matchScore}%) and applied for "${job.title}".`,
            jobId,
            application.id,
          ],
        )
      }

      // Mark queue record as applied
      const updatedQueue = await this.queueRepo.updateStatus(queueItem.id, user.id, {
        status: 'applied',
        applicationId: application.id,
        appliedAt: new Date().toISOString(),
      })

      logger.info('Auto-Apply execution completed successfully', {
        userId: user.id,
        jobId,
        applicationId: application.id,
        matchScore,
      })

      return {
        ok: true,
        eligible: true,
        queue_item: updatedQueue,
        application,
      }
    } catch (err) {
      logger.error('Auto-Apply execution failed during application write', {
        userId: user.id,
        jobId,
        error: err.message,
      })

      const failedQueue = await this.queueRepo.updateStatus(queueItem.id, user.id, {
        status: 'failed',
        failureReason: `Application processing failed: ${err.message}`,
      })

      return {
        ok: false,
        eligible: true,
        reasons: [`Application execution failed: ${err.message}`],
        queue_item: failedQueue,
      }
    }
  }
}

export const autoApplyQueueService = new AutoApplyQueueService()
