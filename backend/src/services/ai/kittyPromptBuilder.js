/**
 * TechNova Job Application Assistant
 * Step 12.5 — Kitty Career Assistant Prompt Builder
 * Formulates structured, grounded prompts for Kitty with strict factuality and persona guidelines.
 */

export class KittyPromptBuilder {
  /**
   * System instruction defining Kitty's persona and strict grounding rules.
   */
  static getSystemInstruction() {
    return [
      'You are Kitty, the official Career AI Assistant for CareerStudio.',
      'Your mission is to guide candidates through their job search, resume improvement, skill development, and application preparation.',
      '',
      'CORE RULES:',
      '1. Be friendly, encouraging, and professional. Introduce yourself as Kitty when appropriate.',
      '2. Ground all factual statements about the candidate or job STRICTLY in the provided context (tagged with [SOURCE: ...]).',
      '3. NEVER invent candidate skills, job history, degrees, or certifications that are not in the context.',
      '4. NEVER invent job requirements or benefits not found in the job context.',
      '5. If a piece of information is missing from the user\'s resume or profile, explicitly note that it is not listed.',
      '6. Deterministic facts (such as match score, application status, dates) are authoritative. Do NOT alter, recalculate, or contradict them.',
      '7. Offer actionable, practical career advice and next steps when relevant.',
      '8. Keep responses concise, clear, and easy to read (use bullet points where appropriate).',
    ].join('\n')
  }

  /**
   * Builds the prompt payload for the local LLM.
   *
   * @param {object} options
   * @param {string} options.message - User message / question
   * @param {string} [options.contextString] - Assembled RAG context string
   * @param {object|null} [options.job] - Target job if available
   * @param {number|null} [options.matchScore] - Authoritative match score percentage
   * @param {Array<object>} [options.recentMessages=[]] - Recent conversation history
   * @returns {{ prompt: string, systemInstruction: string }}
   */
  static buildPrompt({
    message,
    contextString = '',
    job = null,
    matchScore = null,
    recentMessages = [],
  }) {
    const sections = []

    // 1. Target Job Header if contextualized
    if (job) {
      sections.push(
        `TARGET JOB: ${job.title || 'Position'} at ${job.company || 'Company'} (${job.location || 'Location'}, ${job.remote_type || 'Onsite'})`,
      )
      if (matchScore != null) {
        sections.push(`AUTHORITATIVE MATCH SCORE: ${matchScore}% (Deterministic score — do not contradict)`)
      }
      sections.push('')
    }

    // 2. Grounded Context Chunks
    if (contextString && contextString.trim()) {
      sections.push('CAREERSTUDIO RETRIEVED CONTEXT:')
      sections.push(contextString.trim())
      sections.push('')
    }

    // 3. Recent Chat History (Last few turns for dialogue continuity)
    if (Array.isArray(recentMessages) && recentMessages.length > 0) {
      sections.push('CONVERSATION HISTORY:')
      for (const msg of recentMessages.slice(-4)) {
        const role = msg.role === 'user' ? 'Candidate' : 'Kitty'
        sections.push(`${role}: ${msg.content}`)
      }
      sections.push('')
    }

    // 4. Candidate's current question
    sections.push(`CANDIDATE QUESTION: "${message.trim()}"`)
    sections.push('')
    sections.push('Respond as Kitty with a grounded, helpful, and concise answer.')

    return {
      prompt: sections.join('\n'),
      systemInstruction: this.getSystemInstruction(),
    }
  }

  /**
   * Extracts unique referenced source badges from retrieved chunks for UI display.
   *
   * @param {Array<object>} retrievedChunks - Raw chunks from retrievalService
   * @returns {Array<{ source_type: string, label: string }>}
   */
  static formatSourceBadges(retrievedChunks = []) {
    if (!Array.isArray(retrievedChunks)) return []

    const labelMap = {
      resume: 'Your Resume',
      application_profile: 'Your Profile',
      job: 'This Job',
    }

    const seenTypes = new Set()
    const badges = []

    for (const chunk of retrievedChunks) {
      const type = chunk.source_type || 'resume'
      if (seenTypes.has(type)) continue
      seenTypes.add(type)

      badges.push({
        source_type: type,
        label: labelMap[type] || 'CareerStudio Data',
      })
    }

    return badges
  }
}
