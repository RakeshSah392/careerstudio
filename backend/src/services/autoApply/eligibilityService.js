/**
 * TechNova Job Application Assistant
 * Auto-Apply Eligibility Evaluation Service
 * Evaluates candidate eligibility for automatic application submission under strict safety rules.
 */

import { VALID_WORK_MODES } from '../autoApplyService.js'

export class AutoApplyEligibilityService {
  /**
   * Evaluates all strict eligibility rules for a candidate and a specific job.
   * CareerStudio permits automated submission ONLY for internal jobs where CareerStudio controls the lifecycle.
   *
   * @param {object} params
   * @param {object|null} params.user - Authenticated candidate user
   * @param {object|null} params.profile - Application profile
   * @param {object|null} params.autoApplySettings - Candidate's Auto-Apply settings
   * @param {object|null} params.primaryResume - Primary resume record
   * @param {object} params.job - Candidate job listing
   * @param {number} [params.matchScore=0] - Deterministic match score (0-100)
   * @param {boolean} [params.alreadyApplied=false] - Whether user has already applied
   * @returns {object} Detailed eligibility verdict
   */
  evaluate({
    user,
    profile,
    autoApplySettings,
    primaryResume = null,
    job,
    matchScore = 0,
    alreadyApplied = false,
  }) {
    const reasons = []
    const criteria = {
      userAuthenticated: Boolean(user?.id),
      autoApplyEnabled: Boolean(autoApplySettings?.enabled),
      profileComplete: false,
      resumeAvailable: Boolean(primaryResume),
      jobIsOpen: job?.status === 'open',
      notAlreadyApplied: !alreadyApplied,
      matchThresholdSatisfied: false,
      isInternalCareerStudioJob: false,
      workModeAllowed: false,
    }

    if (!user?.id) {
      reasons.push('Candidate must be authenticated.')
    }

    if (!autoApplySettings?.enabled) {
      reasons.push('Auto-Apply is turned OFF in candidate settings.')
    }

    // Check internal vs external: automated submission is restricted to CareerStudio internal jobs
    const isExternal = Boolean(job?.is_external || job?.source_type === 'external' || (job?.source && job?.source !== 'internal'))
    if (isExternal) {
      criteria.isInternalCareerStudioJob = false
      reasons.push('External aggregated jobs cannot be auto-submitted. Candidate must apply on the original source site.')
    } else {
      criteria.isInternalCareerStudioJob = true
    }

    // Threshold check (single source of truth from auto_apply_settings)
    const minThreshold = autoApplySettings?.minimum_match_percentage ?? 80
    if (matchScore >= minThreshold) {
      criteria.matchThresholdSatisfied = true
    } else {
      reasons.push(`Match score (${matchScore}%) does not meet candidate threshold (${minThreshold}%).`)
    }

    // Resume check
    if (autoApplySettings?.require_resume && !primaryResume) {
      reasons.push('A primary resume is required before submitting applications.')
    }

    // Profile completeness check
    const skillsCount = profile?.skills?.length ?? 0
    const hasJobTitle = Boolean(profile?.headline || profile?.current_job_title)
    const isProfileComplete = skillsCount > 0 && hasJobTitle
    criteria.profileComplete = isProfileComplete

    if (autoApplySettings?.require_complete_profile && !isProfileComplete) {
      reasons.push('Application profile is incomplete (must have skills and current title).')
    }

    // Job status check
    if (job?.status !== 'open') {
      reasons.push('Job posting is closed.')
    }

    // Duplicate prevention check
    if (alreadyApplied) {
      reasons.push('An application has already been submitted for this job.')
    }

    // Work mode preference check
    const allowedModes = autoApplySettings?.allowed_work_modes ?? VALID_WORK_MODES
    const jobRemoteType = job?.remote_type ?? 'onsite'
    if (allowedModes.includes(jobRemoteType)) {
      criteria.workModeAllowed = true
    } else {
      reasons.push(`Job work mode "${jobRemoteType}" is not permitted by candidate settings (${allowedModes.join(', ')}).`)
    }

    const eligible = reasons.length === 0

    return {
      eligible,
      reasons,
      criteria,
      matchScore,
      threshold: minThreshold,
      isExternal,
    }
  }
}

export const autoApplyEligibilityService = new AutoApplyEligibilityService()
