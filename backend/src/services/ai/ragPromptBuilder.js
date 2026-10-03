/**
 * TechNova Job Application Assistant
 * Step 12.3 — Grounded RAG Prompt Builder & Response Validator
 * Builds strict grounded prompts and validates LLM JSON outputs against retrieved evidence.
 */

export class RAGPromptBuilder {
  /**
   * System instruction enforcing factual grounding and hallucination controls.
   */
  static getSystemInstruction() {
    return [
      'You are the CareerStudio AI Match Analyst.',
      'Your task is to answer questions regarding how a candidate matches a specific job based STRICTLY and ONLY on the provided context.',
      '',
      'CRITICAL RULES:',
      '1. Ground every statement in the supplied context (tagged with [SOURCE: ...]).',
      '2. Do NOT invent candidate experience, skills, employers, or qualifications not found in the context.',
      '3. Do NOT invent job requirements not stated in the job context.',
      '4. If information is missing or not present, explicitly state that it was not found in the available resume/profile.',
      '5. Do NOT calculate, modify, or output any numerical match score or percentage (the system computes scores deterministically).',
      '6. Cite the exact chunk_id for each piece of evidence referenced.',
      '7. Return ONLY a valid JSON object strictly matching the schema below. No conversational filler or preamble.',
    ].join('\n')
  }

  /**
   * Builds the prompt payload for the local LLM.
   *
   * @param {object} options
   * @param {string} options.question - User question
   * @param {string} options.contextString - Labeled context from RAGContextAssembler
   * @param {object} [options.job] - Target job info
   * @param {number} [options.deterministicScore] - Authoritative deterministic score
   * @returns {{ prompt: string, systemInstruction: string, context: string }}
   */
  static buildPrompt({ question, contextString, job = null, deterministicScore = null }) {
    const userPrompt = [
      `CANDIDATE QUESTION: "${question}"`,
      '',
      job ? `TARGET ROLE: ${job.title} at ${job.company}` : '',
      deterministicScore != null ? `AUTHORITATIVE DETERMINISTIC MATCH: ${deterministicScore}% (DO NOT MODIFY OR CONTRADICT THIS SCORE)` : '',
      '',
      'CONTEXT CHUNKS:',
      contextString,
      '',
      'Provide a factual, grounded analysis in the following JSON format:',
      '{',
      '  "summary": "2-3 sentence overview answering the user question based solely on context.",',
      '  "evidence": [',
      '    {',
      '      "source_type": "resume | application_profile | job",',
      '      "chunk_id": "<exact_chunk_id_from_context>",',
      '      "quote": "<relevant sentence or keyword from the chunk>",',
      '      "relevance": "<why this evidence supports the match or gap>"',
      '    }',
      '  ],',
      '  "strong_matches": ["Direct matching skill or experience backed by context 1", "..."],',
      '  "potential_gaps": ["Requirement in job not found in candidate context 1", "..."],',
      '  "suggestions": ["Actionable step candidate can take before applying 1", "..."]',
      '}',
    ].filter(Boolean).join('\n')

    return {
      prompt: userPrompt,
      systemInstruction: this.getSystemInstruction(),
      context: contextString,
    }
  }

  /**
   * Validates and parses the LLM output JSON with hallucination controls.
   *
   * @param {string} rawText - Raw text from LLM Provider
   * @param {Array<object>} [validChunks=[]] - Retrieved chunks for citation verification
   * @returns {object} Validated response object
   */
  static parseAndValidateResponse(rawText, validChunks = []) {
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('LLM response text is empty.')
    }

    // 1. Strip markdown fences if returned
    let clean = rawText.trim()
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    }

    // Extract first JSON object if surrounded by preamble
    const firstBrace = clean.indexOf('{')
    const lastBrace = clean.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1)
    }

    let parsed = null
    try {
      parsed = JSON.parse(clean)
    } catch {
      // Attempt resilient repair for truncated JSON
      try {
        let repaired = clean
        // Close unclosed strings
        const quoteCount = (repaired.match(/"/g) || []).length
        if (quoteCount % 2 !== 0) repaired += '"'
        // Close unclosed arrays & objects
        const openBraces = (repaired.match(/\{/g) || []).length
        const closeBraces = (repaired.match(/\}/g) || []).length
        const openBrackets = (repaired.match(/\[/g) || []).length
        const closeBrackets = (repaired.match(/\]/g) || []).length
        for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']'
        for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}'
        parsed = JSON.parse(repaired)
      } catch (err) {
        // If JSON still fails, extract key strings using regex
        const summaryMatch = clean.match(/"summary"\s*:\s*"([^"]+)"/i)
        if (summaryMatch) {
          parsed = {
            summary: summaryMatch[1],
            strong_matches: [],
            potential_gaps: [],
            suggestions: [],
          }
        } else {
          throw new Error(`MALFORMED_AI_OUTPUT: Response is not valid JSON (${err.message}). Raw: ${rawText.slice(0, 120)}`)
        }
      }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('MALFORMED_AI_OUTPUT: Output must be a JSON object.')
    }

    // 2. Validate expected fields
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Grounded match analysis generated from candidate and job context.'

    const strongMatches = Array.isArray(parsed.strong_matches)
      ? parsed.strong_matches.filter((item) => typeof item === 'string' && item.trim()).map((s) => s.trim())
      : []

    const potentialGaps = Array.isArray(parsed.potential_gaps)
      ? parsed.potential_gaps.filter((item) => typeof item === 'string' && item.trim()).map((s) => s.trim())
      : []

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((item) => typeof item === 'string' && item.trim()).map((s) => s.trim())
      : []

    // 3. Hallucination Control on Evidence Citations
    // Check evidence against valid chunks retrieved for this request
    const validChunkIds = new Set(validChunks.map((c) => String(c.chunk_id)))
    const validatedEvidence = []

    if (Array.isArray(parsed.evidence)) {
      for (const item of parsed.evidence) {
        if (!item || typeof item !== 'object') continue

        const chunkId = String(item.chunk_id || '')
        // If chunk ID is valid or matches one of our retrieved chunks
        const isValidChunk = validChunkIds.size === 0 || validChunkIds.has(chunkId)

        if (isValidChunk) {
          validatedEvidence.push({
            source_type: ['resume', 'application_profile', 'job'].includes(item.source_type)
              ? item.source_type
              : (validChunks.find((c) => c.chunk_id === chunkId)?.source_type || 'resume'),
            chunk_id: chunkId || (validChunks[0]?.chunk_id || 'unknown_chunk'),
            quote: typeof item.quote === 'string' ? item.quote.slice(0, 300) : '',
            relevance: typeof item.relevance === 'string' ? item.relevance.slice(0, 300) : '',
          })
        }
      }
    }

    // If LLM did not provide citations or cited hallucinated chunk IDs, construct grounded citations from top retrieved chunks
    if (validatedEvidence.length === 0 && validChunks.length > 0) {
      for (const chunk of validChunks.slice(0, 3)) {
        validatedEvidence.push({
          source_type: chunk.source_type,
          chunk_id: chunk.chunk_id,
          quote: chunk.content ? chunk.content.slice(0, 160) + '...' : '',
          relevance: `Top retrieved context with relevance similarity ${chunk.similarity || 0}`,
        })
      }
    }

    return {
      summary,
      evidence: validatedEvidence,
      strong_matches: strongMatches,
      potential_gaps: potentialGaps,
      suggestions: suggestions,
    }
  }
}
