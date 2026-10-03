/**
 * TechNova Job Application Assistant
 * Step 12.1 — Job Match Explanation Prompt Builder
 * Assembles sanitized, strictly bounded prompts for local LLM inference.
 */

export class JobMatchPromptBuilder {
  /**
   * Builds system and user prompts for explaining a job match.
   *
   * @param {object} options
   * @param {object} options.job - Target job posting
   * @param {object} options.candidateProfile - Verified seeker profile data
   * @param {string} [options.resumeText] - Sanitized text content from primary resume
   * @param {number} options.matchScore - Authoritative deterministic match score (0-100)
   * @param {object} options.matchBreakdown - Breakdown components (role, skills, experience, location)
   * @returns {{ systemInstruction: string, prompt: string, context: object }}
   */
  static buildExplanationPrompt({
    job,
    candidateProfile = {},
    resumeText = '',
    matchScore,
    matchBreakdown = {},
  }) {
    const systemInstruction = [
      'You are CareerStudio’s AI Career Advisor.',
      'Your task is to analyze and explain why a candidate aligns with an open job posting based STRICTLY on provided facts.',
      '',
      'OUTPUT FORMAT:',
      'You must respond ONLY with a valid JSON object with the following schema:',
      '{',
      '  "summary": "A concise 1-2 sentence overview explaining the overall fit.",',
      '  "strong_matches": ["Specific matching skill or qualification", "Another verified strong match"],',
      '  "potential_gaps": ["Missing skill or unverified requirement", "Area where profile has less coverage"],',
      '  "suggestions": ["Practical, actionable advice to strengthen the application"]',
      '}',
      '',
      'STRICT CONSTRAINTS:',
      '1. Use ONLY the supplied candidate facts and job requirements.',
      '2. NEVER invent candidate skills, certifications, degrees, or experience not mentioned in the profile or resume.',
      '3. NEVER invent job requirements not present in the job description.',
      '4. NEVER calculate, alter, or override the supplied deterministic match percentage.',
      '5. Clearly distinguish missing/unspecified information from verified qualifications.',
      '6. Keep bullet points concise and professional (maximum 3-4 bullets per category).',
      '7. Do NOT include markdown code fences or conversational text outside the JSON object.',
    ].join('\n')

    const cleanResumeExcerpt = resumeText
      ? resumeText.slice(0, 1500).replace(/\s+/g, ' ').trim()
      : null

    const context = {
      job: {
        title: job.title || '',
        company: job.company || '',
        location: job.location || '',
        remote_type: job.remote_type || 'onsite',
        employment_type: job.employment_type || 'full-time',
        description: (job.description || '').slice(0, 1500),
      },
      candidate: {
        headline: candidateProfile?.headline || '',
        current_job_title: candidateProfile?.current_job_title || '',
        skills: Array.isArray(candidateProfile?.skills) ? candidateProfile.skills : [],
        experience_level: candidateProfile?.experience_level || '',
        years_of_experience: candidateProfile?.years_of_experience ?? null,
        work_authorization: candidateProfile?.work_authorization || '',
        resume_excerpt: cleanResumeExcerpt,
      },
      deterministic_match: {
        authoritative_score_percentage: matchScore,
        sub_scores: {
          role_match: matchBreakdown?.role ?? null,
          skills_match: matchBreakdown?.skills ?? null,
          experience_match: matchBreakdown?.experience ?? null,
          location_and_work_mode: matchBreakdown?.location ?? null,
        },
      },
    }

    const prompt = [
      `Analyze the candidate's alignment for the position "${job.title}" at "${job.company}".`,
      `The CareerStudio deterministic matching engine computed an authoritative match score of ${matchScore}%.`,
      'Provide a clear, fact-based breakdown of strong matching areas, potential gaps, and actionable recommendations in the specified JSON format.',
    ].join(' ')

    return {
      systemInstruction,
      prompt,
      context,
    }
  }

  /**
   * Safely parses and normalizes the LLM JSON response.
   * Falls back to a structured object if raw string isn't perfectly valid JSON.
   */
  static parseExplanationResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return {
        summary: 'Match analysis generated based on deterministic profile evaluation.',
        strong_matches: [],
        potential_gaps: [],
        suggestions: [],
      }
    }

    let cleaned = rawText.trim()
    // Remove markdown code fences if model returned ```json ... ```
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    }

    try {
      const parsed = JSON.parse(cleaned)
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : 'Profile analysis completed.',
        strong_matches: Array.isArray(parsed.strong_matches)
          ? parsed.strong_matches.filter((s) => typeof s === 'string')
          : [],
        potential_gaps: Array.isArray(parsed.potential_gaps)
          ? parsed.potential_gaps.filter((s) => typeof s === 'string')
          : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.filter((s) => typeof s === 'string')
          : [],
      }
    } catch {
      // Fallback: extract sentences or structured text safely
      return {
        summary: cleaned.slice(0, 300),
        strong_matches: [],
        potential_gaps: [],
        suggestions: [],
      }
    }
  }
}
