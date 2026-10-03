export const QuestionCategory = {
  STRUCTURED: 'STRUCTURED',
  GENERATIVE: 'GENERATIVE',
  USER_CONFIRMATION_REQUIRED: 'USER_CONFIRMATION_REQUIRED',
}

const STRUCTURED_PATTERNS = [
  { pattern: /salary|compensation|ctc|pay|expected\s*comp/i, field: 'expected_salary' },
  { pattern: /notice\s*period|availability|joining|how\s*soon/i, field: 'notice_period' },
  { pattern: /experience|years\s*of\s*exp/i, field: 'years_of_experience' },
  { pattern: /relocat(e|ion)|willing\s*to\s*move/i, field: 'willing_to_relocate' },
  { pattern: /work\s*auth|visa|sponsorship|eligible\s*to\s*work|citizen/i, field: 'work_authorization' },
  { pattern: /shift|night\s*shift|work\s*hours/i, field: 'shift_availability' },
]

const CONFIRMATION_PATTERNS = [
  { pattern: /background\s*check|criminal|drug\s*screen|felony/i, reason: 'Legal and background screening requires explicit candidate authorization.' },
  { pattern: /clearance|security\s*clearance|polygraph/i, reason: 'Government or defense security clearance requires direct candidate confirmation.' },
  { pattern: /non-compete|nda|prior\s*employer\s*agreement/i, reason: 'Legal agreement obligations require candidate review.' },
]

export function classifyQuestion(questionText) {
  if (typeof questionText !== 'string' || !questionText.trim()) {
    return { category: QuestionCategory.USER_CONFIRMATION_REQUIRED, mappedField: null }
  }

  for (const item of CONFIRMATION_PATTERNS) {
    if (item.pattern.test(questionText)) {
      return {
        category: QuestionCategory.USER_CONFIRMATION_REQUIRED,
        mappedField: null,
        reason: item.reason,
      }
    }
  }

  for (const item of STRUCTURED_PATTERNS) {
    if (item.pattern.test(questionText)) {
      return {
        category: QuestionCategory.STRUCTURED,
        mappedField: item.field,
      }
    }
  }

  return {
    category: QuestionCategory.GENERATIVE,
    mappedField: null,
  }
}

export function extractStructuredAnswer(mappedField, profile) {
  if (!profile) return null

  switch (mappedField) {
    case 'expected_salary':
      if (profile.expected_salary != null) {
        return `${profile.salary_currency || 'USD'} ${Number(profile.expected_salary).toLocaleString()} per ${profile.salary_period || 'year'}`
      }
      return null
    case 'notice_period':
      if (profile.joining_status === 'immediate') return 'Immediate (0 days)'
      if (profile.notice_period_days != null) return `${profile.notice_period_days} days`
      if (profile.available_from) return `Available from ${profile.available_from}`
      return null
    case 'years_of_experience':
      if (profile.years_of_experience != null) {
        return `${profile.years_of_experience} years`
      }
      return null
    case 'willing_to_relocate':
      return profile.willing_to_relocate ? 'Yes' : 'No'
    case 'work_authorization':
      return profile.work_authorization || null
    case 'shift_availability':
      return profile.shift_availability ? `${profile.shift_availability} shift` : null
    default:
      return profile.custom_answers?.[mappedField] ?? null
  }
}

export async function resolveApplicationQuestion({
  questionText,
  profile,
  aiService = null,
  primaryResume = null,
  job = null,
}) {
  const classification = classifyQuestion(questionText)

  if (classification.category === QuestionCategory.USER_CONFIRMATION_REQUIRED) {
    return {
      category: QuestionCategory.USER_CONFIRMATION_REQUIRED,
      answer: null,
      status: 'confirmation_required',
      reason: classification.reason,
    }
  }

  if (classification.category === QuestionCategory.STRUCTURED) {
    const answer = extractStructuredAnswer(classification.mappedField, profile)
    if (answer !== null) {
      return {
        category: QuestionCategory.STRUCTURED,
        answer,
        status: 'resolved_from_profile',
        mappedField: classification.mappedField,
      }
    }
    return {
      category: QuestionCategory.STRUCTURED,
      answer: null,
      status: 'missing_profile_data',
      mappedField: classification.mappedField,
    }
  }

  // GENERATIVE: Delegates to pluggable AI service contract if available
  if (aiService && typeof aiService.generateAnswer === 'function') {
    const aiResult = await aiService.generateAnswer({
      question: questionText,
      profile,
      resume: primaryResume,
      job,
    })
    return {
      category: QuestionCategory.GENERATIVE,
      answer: aiResult.answer,
      status: aiResult.status,
    }
  }

  // Fallback when AI is not configured
  return {
    category: QuestionCategory.GENERATIVE,
    answer: null,
    status: 'ai_service_unavailable',
  }
}
