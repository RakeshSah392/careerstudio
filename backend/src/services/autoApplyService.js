import { isStringArray } from '../lib/validation.js'
import { autoApplyRepository } from '../repositories/autoApplyRepository.js'

export const VALID_WORK_MODES = ['remote', 'hybrid', 'onsite']

export function validateAutoApplySettings(body) {
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return 'enabled must be a boolean.'
  }

  if (body.minimum_match_percentage !== undefined) {
    const pct = Number(body.minimum_match_percentage)
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      return 'minimum_match_percentage must be an integer between 1 and 100.'
    }
  }

  if (body.allowed_job_sources !== undefined && !isStringArray(body.allowed_job_sources)) {
    return 'allowed_job_sources must be an array of strings.'
  }

  if (body.allowed_employment_types !== undefined && !isStringArray(body.allowed_employment_types)) {
    return 'allowed_employment_types must be an array of strings.'
  }

  if (body.allowed_work_modes !== undefined) {
    if (!isStringArray(body.allowed_work_modes)) {
      return 'allowed_work_modes must be an array of strings.'
    }
    for (const mode of body.allowed_work_modes) {
      if (!VALID_WORK_MODES.includes(mode)) {
        return `Invalid work mode "${mode}". Allowed: ${VALID_WORK_MODES.join(', ')}`
      }
    }
  }

  if (body.require_resume !== undefined && typeof body.require_resume !== 'boolean') {
    return 'require_resume must be a boolean.'
  }

  if (body.require_complete_profile !== undefined && typeof body.require_complete_profile !== 'boolean') {
    return 'require_complete_profile must be a boolean.'
  }

  return null
}

export class AutoApplyService {
  constructor(repository = autoApplyRepository) {
    this.repository = repository
  }

  async getSettings(userId) {
    const settings = await this.repository.findByUserId(userId)
    if (settings) return settings

    // Return safe default state (Auto-Apply OFF)
    return {
      id: null,
      user_id: userId,
      enabled: false,
      minimum_match_percentage: 80,
      allowed_job_sources: ['direct', 'recruiter'],
      allowed_employment_types: ['full-time', 'contract', 'part-time'],
      allowed_work_modes: ['remote', 'hybrid', 'onsite'],
      require_resume: true,
      require_complete_profile: true,
    }
  }

  async updateSettings(userId, data) {
    const validationError = validateAutoApplySettings(data)
    if (validationError) {
      const error = new Error(validationError)
      error.status = 400
      throw error
    }

    const current = await this.repository.findByUserId(userId)
    if (!current) {
      return this.repository.upsertSettings(userId, data)
    }
    return this.repository.updateSettings(userId, data)
  }

  /**
   * Evaluates eligibility for auto-apply without automatically executing an application.
   * Serves as the pure domain evaluation contract.
   */
  evaluateAutoApplyEligibility({
    profile,
    autoApplySettings,
    job,
    matchScore = 0,
    primaryResume = null,
    alreadyApplied = false,
  }) {
    const reasons = []
    const criteriaStatus = {
      autoApplyEnabled: Boolean(autoApplySettings?.enabled),
      matchThresholdSatisfied: false,
      resumeAvailable: Boolean(primaryResume),
      profileComplete: false,
      jobOpen: job?.status === 'open',
      workModeAllowed: false,
      notAlreadyApplied: !alreadyApplied,
    }

    if (!autoApplySettings?.enabled) {
      reasons.push('Auto-Apply is disabled by candidate.')
    }

    const minMatch = autoApplySettings?.minimum_match_percentage ?? 80
    if (matchScore >= minMatch) {
      criteriaStatus.matchThresholdSatisfied = true
    } else {
      reasons.push(`Match score (${matchScore}%) is below candidate threshold (${minMatch}%).`)
    }

    if (autoApplySettings?.require_resume && !primaryResume) {
      reasons.push('A primary resume is required for auto-apply.')
    }

    const profileSkillsCount = profile?.skills?.length ?? 0
    const profileHasTitle = Boolean(profile?.headline || profile?.current_job_title)
    const isProfileComplete = profileSkillsCount > 0 && profileHasTitle

    criteriaStatus.profileComplete = isProfileComplete
    if (autoApplySettings?.require_complete_profile && !isProfileComplete) {
      reasons.push('Application profile must be completed before auto-applying.')
    }

    if (job?.status !== 'open') {
      reasons.push('Job is not open.')
    }

    if (alreadyApplied) {
      reasons.push('Candidate has already applied to this job.')
    }

    const allowedModes = autoApplySettings?.allowed_work_modes ?? VALID_WORK_MODES
    const jobRemoteType = job?.remote_type ?? 'onsite'
    if (allowedModes.includes(jobRemoteType)) {
      criteriaStatus.workModeAllowed = true
    } else {
      reasons.push(`Job work mode "${jobRemoteType}" is not in candidate's allowed modes (${allowedModes.join(', ')}).`)
    }

    const eligible = reasons.length === 0

    return {
      eligible,
      reasons,
      criteriaStatus,
      matchScore,
      minimumRequiredMatch: minMatch,
    }
  }
}

export const autoApplyService = new AutoApplyService()
