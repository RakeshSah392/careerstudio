/**
 * TechNova Job Application Assistant
 * Step 12.3 — RAG Context Assembler
 * Assembles, labels, deduplicates, and bounds retrieved chunks into a prompt-ready context block.
 */

export class RAGContextAssembler {
  constructor({
    maxContextChars = 6000,
    maxChunks = 8,
  } = {}) {
    this.maxContextChars = maxContextChars
    this.maxChunks = maxChunks
  }

  /**
   * Sanitizes text to prevent accidental leakage of sensitive tokens, OTPs, or passwords.
   */
  sanitizeChunkContent(text) {
    if (!text || typeof text !== 'string') return ''
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\b(?:password|otp|secret|api[_-]?key|session[_-]?token)\s*[:=]\s*\S+/gi, '[REDACTED_SECRET]')
      .trim()
  }

  /**
   * Assembles retrieved chunks into a structured, labeled context block.
   *
   * @param {object} options
   * @param {Array<object>} options.chunks - Retrieved chunks from RetrievalService
   * @param {object} [options.jobMetadata] - Authoritative job title/company info
   * @param {object} [options.candidateMetadata] - Authoritative candidate name/headline info
   * @returns {{
   *   contextString: string,
   *   evidenceList: Array<object>,
   *   chunkCount: number,
   *   sources: { resume: number, application_profile: number, job: number }
   * }}
   */
  assembleContext({ chunks = [], jobMetadata = null, candidateMetadata = null }) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return {
        contextString: 'No relevant candidate or job context chunks were found.',
        evidenceList: [],
        chunkCount: 0,
        sources: { resume: 0, application_profile: 0, job: 0 },
      }
    }

    const seenContents = new Set()
    const evidenceList = []
    const contextSections = []
    const sources = { resume: 0, application_profile: 0, job: 0 }
    let currentTotalChars = 0

    // Bounded chunk processing
    const sortedChunks = [...chunks].sort((a, b) => (b.similarity || 0) - (a.similarity || 0))

    for (const chunk of sortedSections(sortedChunks, this.maxChunks)) {
      const cleanContent = this.sanitizeChunkContent(chunk.content)
      if (!cleanContent) continue

      // Deduplication: prevent identical chunk content from consuming the context window
      const contentKey = cleanContent.toLowerCase().replace(/\s+/g, ' ')
      if (seenContents.has(contentKey)) continue
      seenContents.add(contentKey)

      // Budget check: ensure total context stays within Qwen context limits
      const sectionHeader = `[SOURCE: ${chunk.source_type.toUpperCase()} | CHUNK_ID: ${chunk.chunk_id} | RELEVANCE: ${chunk.similarity}]`
      const formattedBlock = `${sectionHeader}\n${cleanContent}\n`

      if (currentTotalChars + formattedBlock.length > this.maxContextChars) {
        // Stop if adding this chunk exceeds maximum context window size
        break
      }

      currentTotalChars += formattedBlock.length
      contextSections.push(formattedBlock)

      // Track evidence metadata for citations
      evidenceList.push({
        source_type: chunk.source_type,
        source_id: chunk.source_id,
        chunk_id: chunk.chunk_id,
        similarity: chunk.similarity || 0,
        excerpt: cleanContent.slice(0, 160) + (cleanContent.length > 160 ? '...' : ''),
      })

      if (sources[chunk.source_type] !== undefined) {
        sources[chunk.source_type] += 1
      }
    }

    let header = '--- AUTHORITATIVE TASK CONTEXT ---\n'
    if (jobMetadata) {
      header += `TARGET JOB: ${jobMetadata.title || 'Untitled'} at ${jobMetadata.company || 'Unknown Company'}\n`
    }
    if (candidateMetadata) {
      header += `CANDIDATE: ${candidateMetadata.headline || 'Job Seeker'}\n`
    }
    header += '-----------------------------------\n\n'

    const contextString = header + contextSections.join('\n')

    return {
      contextString,
      evidenceList,
      chunkCount: evidenceList.length,
      sources,
    }
  }
}

function sortedSections(chunks, limit) {
  return chunks.slice(0, limit)
}

export const ragContextAssembler = new RAGContextAssembler()
