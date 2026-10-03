import { pool } from '../db.js'

const profileFields = [
  'headline',
  'current_job_title',
  'professional_introduction',
  'skills',
  'experience_level',
  'years_of_experience',
  'joining_status',
  'notice_period_days',
  'available_from',
  'willing_to_relocate',
  'expected_salary',
  'minimum_acceptable_salary',
  'salary_currency',
  'salary_period',
  'preferred_roles',
  'preferred_locations',
  'remote_preference',
  'employment_types',
  'preferred_industries',
  'work_authorization',
  'shift_availability',
  'relocation_preference',
  'custom_answers',
]

const profileSelection = `
  id,
  user_id,
  headline,
  current_job_title,
  professional_introduction,
  skills,
  experience_level,
  years_of_experience,
  joining_status,
  notice_period_days,
  available_from,
  willing_to_relocate,
  expected_salary,
  minimum_acceptable_salary,
  salary_currency,
  salary_period,
  preferred_roles,
  preferred_locations,
  remote_preference,
  employment_types,
  preferred_industries,
  work_authorization,
  shift_availability,
  relocation_preference,
  custom_answers,
  created_at,
  updated_at
`

export class ApplicationProfileRepository {
  async findByUserId(userId, client = pool) {
    const result = await client.query(
      `SELECT ${profileSelection} FROM application_profiles WHERE user_id = $1`,
      [userId],
    )
    return result.rows[0] ?? null
  }

  async upsertProfile(userId, profileData, client = pool) {
    const values = [
      userId,
      profileData.headline ?? '',
      profileData.current_job_title ?? '',
      profileData.professional_introduction ?? '',
      profileData.skills ?? [],
      profileData.experience_level ?? 'mid',
      profileData.years_of_experience ?? 0,
      profileData.joining_status ?? 'immediate',
      profileData.notice_period_days ?? 0,
      profileData.available_from ?? null,
      profileData.willing_to_relocate ?? false,
      profileData.expected_salary ?? null,
      profileData.minimum_acceptable_salary ?? null,
      (profileData.salary_currency ?? 'USD').toUpperCase(),
      profileData.salary_period ?? 'yearly',
      profileData.preferred_roles ?? [],
      profileData.preferred_locations ?? [],
      profileData.remote_preference ?? 'any',
      profileData.employment_types ?? [],
      profileData.preferred_industries ?? [],
      profileData.work_authorization ?? '',
      profileData.shift_availability ?? 'day',
      profileData.relocation_preference ?? 'open',
      JSON.stringify(profileData.custom_answers ?? {}),
    ]

    const result = await client.query(
      `INSERT INTO application_profiles (
        user_id, headline, current_job_title, professional_introduction, skills,
        experience_level, years_of_experience, joining_status, notice_period_days,
        available_from, willing_to_relocate, expected_salary, minimum_acceptable_salary,
        salary_currency, salary_period, preferred_roles, preferred_locations,
        remote_preference, employment_types, preferred_industries, work_authorization,
        shift_availability, relocation_preference, custom_answers
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24
      )
      ON CONFLICT (user_id) DO UPDATE SET
        headline = EXCLUDED.headline,
        current_job_title = EXCLUDED.current_job_title,
        professional_introduction = EXCLUDED.professional_introduction,
        skills = EXCLUDED.skills,
        experience_level = EXCLUDED.experience_level,
        years_of_experience = EXCLUDED.years_of_experience,
        joining_status = EXCLUDED.joining_status,
        notice_period_days = EXCLUDED.notice_period_days,
        available_from = EXCLUDED.available_from,
        willing_to_relocate = EXCLUDED.willing_to_relocate,
        expected_salary = EXCLUDED.expected_salary,
        minimum_acceptable_salary = EXCLUDED.minimum_acceptable_salary,
        salary_currency = EXCLUDED.salary_currency,
        salary_period = EXCLUDED.salary_period,
        preferred_roles = EXCLUDED.preferred_roles,
        preferred_locations = EXCLUDED.preferred_locations,
        remote_preference = EXCLUDED.remote_preference,
        employment_types = EXCLUDED.employment_types,
        preferred_industries = EXCLUDED.preferred_industries,
        work_authorization = EXCLUDED.work_authorization,
        shift_availability = EXCLUDED.shift_availability,
        relocation_preference = EXCLUDED.relocation_preference,
        custom_answers = EXCLUDED.custom_answers,
        updated_at = NOW()
      RETURNING ${profileSelection}`,
      values,
    )
    return result.rows[0]
  }

  async updateProfile(userId, partialData, client = pool) {
    const fieldsToUpdate = profileFields.filter((field) => partialData[field] !== undefined)
    if (!fieldsToUpdate.length) {
      return this.findByUserId(userId, client)
    }

    const values = []
    const assignments = fieldsToUpdate.map((field, index) => {
      let val = partialData[field]
      if (field === 'salary_currency' && typeof val === 'string') {
        val = val.toUpperCase()
      } else if (field === 'custom_answers') {
        val = JSON.stringify(val ?? {})
      }
      values.push(val)
      return `${field} = $${index + 1}`
    })

    values.push(userId)
    const result = await client.query(
      `UPDATE application_profiles
       SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE user_id = $${values.length}
       RETURNING ${profileSelection}`,
      values,
    )
    return result.rows[0] ?? null
  }

  async deleteProfile(userId, client = pool) {
    const result = await client.query(
      'DELETE FROM application_profiles WHERE user_id = $1 RETURNING id',
      [userId],
    )
    return result.rowCount > 0
  }
}

export const applicationProfileRepository = new ApplicationProfileRepository()
