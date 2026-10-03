import { pool } from '../db.js'
import { isStringArray } from '../lib/validation.js'
import { applicationProfileRepository } from '../repositories/applicationProfileRepository.js'

export const VALID_EXPERIENCE_LEVELS = ['entry', 'mid', 'senior', 'lead', 'executive']
export const VALID_JOINING_STATUSES = ['immediate', 'serving_notice', 'available_from_date', 'casually_looking']
export const VALID_SALARY_PERIODS = ['yearly', 'monthly', 'hourly']
export const VALID_REMOTE_PREFERENCES = ['any', 'remote', 'hybrid', 'onsite']
export const VALID_SHIFT_AVAILABILITIES = ['day', 'night', 'flexible', 'rotational']
export const VALID_RELOCATION_PREFERENCES = ['open', 'reluctant', 'no', 'specific_locations_only']

export function validateApplicationProfile(body, { partial = false } = {}) {
  const textFields = ['headline', 'current_job_title', 'professional_introduction', 'work_authorization']
  for (const field of textFields) {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      return `${field} must be text.`
    }
  }

  const arrayFields = ['skills', 'preferred_roles', 'preferred_locations', 'employment_types', 'preferred_industries']
  for (const field of arrayFields) {
    if (body[field] !== undefined && !isStringArray(body[field])) {
      return `${field} must be an array of non-empty strings.`
    }
  }

  if (body.experience_level !== undefined && !VALID_EXPERIENCE_LEVELS.includes(body.experience_level)) {
    return `Invalid experience_level. Allowed: ${VALID_EXPERIENCE_LEVELS.join(', ')}`
  }

  if (body.joining_status !== undefined && !VALID_JOINING_STATUSES.includes(body.joining_status)) {
    return `Invalid joining_status. Allowed: ${VALID_JOINING_STATUSES.join(', ')}`
  }

  if (body.salary_period !== undefined && !VALID_SALARY_PERIODS.includes(body.salary_period)) {
    return `Invalid salary_period. Allowed: ${VALID_SALARY_PERIODS.join(', ')}`
  }

  if (body.remote_preference !== undefined && !VALID_REMOTE_PREFERENCES.includes(body.remote_preference)) {
    return `Invalid remote_preference. Allowed: ${VALID_REMOTE_PREFERENCES.join(', ')}`
  }

  if (body.shift_availability !== undefined && !VALID_SHIFT_AVAILABILITIES.includes(body.shift_availability)) {
    return `Invalid shift_availability. Allowed: ${VALID_SHIFT_AVAILABILITIES.join(', ')}`
  }

  if (body.relocation_preference !== undefined && !VALID_RELOCATION_PREFERENCES.includes(body.relocation_preference)) {
    return `Invalid relocation_preference. Allowed: ${VALID_RELOCATION_PREFERENCES.join(', ')}`
  }

  if (body.salary_currency !== undefined && (typeof body.salary_currency !== 'string' || !/^[A-Za-z]{3}$/.test(body.salary_currency))) {
    return 'salary_currency must be a three-letter code (e.g. USD, EUR, INR).'
  }

  if (body.years_of_experience !== undefined && body.years_of_experience !== null) {
    const years = Number(body.years_of_experience)
    if (!Number.isFinite(years) || years < 0 || years > 100) {
      return 'years_of_experience must be a non-negative number between 0 and 100.'
    }
  }

  if (body.notice_period_days !== undefined && body.notice_period_days !== null) {
    const days = Number(body.notice_period_days)
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      return 'notice_period_days must be an integer between 0 and 365.'
    }
  }

  const expectedSalary = body.expected_salary
  const minSalary = body.minimum_acceptable_salary

  for (const [name, val] of [['expected_salary', expectedSalary], ['minimum_acceptable_salary', minSalary]]) {
    if (val !== undefined && val !== null && (!Number.isFinite(Number(val)) || Number(val) < 0)) {
      return `${name} must be a non-negative number.`
    }
  }

  if (expectedSalary != null && minSalary != null && Number(minSalary) > Number(expectedSalary)) {
    return 'minimum_acceptable_salary cannot exceed expected_salary.'
  }

  if (body.available_from !== undefined && body.available_from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.available_from)) {
    return 'available_from must use YYYY-MM-DD format.'
  }

  if (body.willing_to_relocate !== undefined && typeof body.willing_to_relocate !== 'boolean') {
    return 'willing_to_relocate must be a boolean.'
  }

  if (body.custom_answers !== undefined && (typeof body.custom_answers !== 'object' || body.custom_answers === null || Array.isArray(body.custom_answers))) {
    return 'custom_answers must be a key-value object.'
  }

  return null
}

export class ApplicationProfileService {
  constructor(repository = applicationProfileRepository) {
    this.repository = repository
  }

  evaluateProfileCompleteness(profile, primaryResume = null) {
    const checks = [
      { key: 'headline', label: 'Professional Headline', points: 15, passed: Boolean(profile?.headline?.trim()) },
      { key: 'skills', label: 'Key Skills', points: 20, passed: Boolean(profile?.skills?.length > 0) },
      { key: 'current_job_title', label: 'Job Title & Experience', points: 15, passed: Boolean(profile?.current_job_title?.trim() || Number(profile?.years_of_experience) > 0) },
      { key: 'joining_status', label: 'Availability & Notice Period', points: 15, passed: Boolean(profile?.joining_status) },
      { key: 'expected_salary', label: 'Salary Expectations', points: 15, passed: Boolean(profile?.expected_salary != null || profile?.minimum_acceptable_salary != null) },
      { key: 'work_authorization', label: 'Work Authorization', points: 10, passed: Boolean(profile?.work_authorization?.trim()) },
      { key: 'primary_resume', label: 'Primary Resume', points: 10, passed: Boolean(primaryResume) },
    ]

    let completenessScore = 0
    const missingFields = []
    const breakdown = {}

    for (const check of checks) {
      breakdown[check.key] = check.passed
      if (check.passed) {
        completenessScore += check.points
      } else {
        missingFields.push(check.label)
      }
    }

    const isComplete = completenessScore >= 70 && Boolean(primaryResume)

    return {
      completenessScore,
      isComplete,
      missingFields,
      breakdown,
    }
  }

  async getProfileWithCompleteness(userId) {
    const [profile, resumeResult] = await Promise.all([
      this.repository.findByUserId(userId),
      pool.query(
        `SELECT id, title, source_filename, mime_type, file_size_bytes, storage_key, is_primary, created_at, updated_at
         FROM resumes
         WHERE user_id = $1 AND is_primary = true
         ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      ),
    ])

    const primaryResume = resumeResult.rows[0] ?? null
    const completeness = this.evaluateProfileCompleteness(profile, primaryResume)

    return {
      profile,
      completeness,
      primaryResume,
    }
  }

  async saveProfile(userId, profileData) {
    const validationError = validateApplicationProfile(profileData)
    if (validationError) {
      const error = new Error(validationError)
      error.status = 400
      throw error
    }
    const profile = await this.repository.upsertProfile(userId, profileData)
    return this.getProfileWithCompleteness(userId)
  }

  async updateProfile(userId, partialData) {
    const validationError = validateApplicationProfile(partialData, { partial: true })
    if (validationError) {
      const error = new Error(validationError)
      error.status = 400
      throw error
    }
    const profile = await this.repository.updateProfile(userId, partialData)
    return this.getProfileWithCompleteness(userId)
  }
}

export const applicationProfileService = new ApplicationProfileService()
