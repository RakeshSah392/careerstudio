/**
 * TechNova Job Application Assistant
 * Step 12.2 — Deterministic Content Chunker & Hasher
 * Splits structured candidate and job texts into provider-neutral, hashable chunks.
 */

import { createHash } from 'node:crypto'

export function computeContentHash({ sourceType, sourceId, chunkId, content }) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim()
  const payload = `${sourceType}:${sourceId}:${chunkId}:${normalized}`
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

export class DeterministicChunker {
  /**
   * Normalizes text by removing non-printable characters and collapsing duplicate whitespace.
   */
  static normalizeText(text) {
    if (!text || typeof text !== 'string') return ''
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /**
   * Chunks resume text into overlapping sliding window sections.
   *
   * @param {object} options
   * @param {string} options.resumeId - UUID of the resume
   * @param {string} options.userId - Owner user UUID
   * @param {string} options.text - Raw text extracted from resume
   * @param {number} [options.chunkSizeWords=150]
   * @param {number} [options.overlapWords=30]
   * @returns {Array<object>}
   */
  static chunkResume({ resumeId, userId, text, chunkSizeWords = 150, overlapWords = 30 }) {
    const cleanText = this.normalizeText(text)
    if (!cleanText) return []

    const words = cleanText.split(/\s+/)
    if (words.length <= chunkSizeWords) {
      const chunkId = `${resumeId}_chunk_0`
      const content = cleanText
      return [
        {
          source_type: 'resume',
          source_id: resumeId,
          user_id: userId,
          chunk_id: chunkId,
          content,
          content_hash: computeContentHash({ sourceType: 'resume', sourceId: resumeId, chunkId, content }),
          metadata: { chunk_index: 0, total_chunks: 1, word_count: words.length },
        },
      ]
    }

    const chunks = []
    let startIdx = 0
    let chunkIndex = 0

    while (startIdx < words.length) {
      const endIdx = Math.min(startIdx + chunkSizeWords, words.length)
      const chunkWords = words.slice(startIdx, endIdx)
      const content = chunkWords.join(' ')
      const chunkId = `${resumeId}_chunk_${chunkIndex}`

      chunks.push({
        source_type: 'resume',
        source_id: resumeId,
        user_id: userId,
        chunk_id: chunkId,
        content,
        content_hash: computeContentHash({ sourceType: 'resume', sourceId: resumeId, chunkId, content }),
        metadata: {
          chunk_index: chunkIndex,
          start_word: startIdx,
          end_word: endIdx,
          word_count: chunkWords.length,
        },
      })

      if (endIdx >= words.length) break
      startIdx += Math.max(1, chunkSizeWords - overlapWords)
      chunkIndex += 1
    }

    return chunks
  }

  /**
   * Chunks an application profile into structured thematic chunks.
   *
   * @param {object} options
   * @param {string} options.profileId - UUID of profile or user
   * @param {string} options.userId - Owner user UUID
   * @param {object} options.profile - Application profile entity
   * @returns {Array<object>}
   */
  static chunkApplicationProfile({ profileId, userId, profile = {} }) {
    const chunks = []

    // 1. Headline & Professional Summary
    const summaryParts = [
      profile.headline ? `Headline: ${profile.headline}` : '',
      profile.current_job_title ? `Current Title: ${profile.current_job_title}` : '',
      profile.experience_level ? `Level: ${profile.experience_level}` : '',
      profile.years_of_experience != null ? `Years of Experience: ${profile.years_of_experience}` : '',
      profile.summary ? `Summary: ${profile.summary}` : '',
    ].filter(Boolean)

    if (summaryParts.length > 0) {
      const content = summaryParts.join('\n')
      const chunkId = `${profileId}_profile_summary`
      chunks.push({
        source_type: 'application_profile',
        source_id: profileId,
        user_id: userId,
        chunk_id: chunkId,
        content,
        content_hash: computeContentHash({ sourceType: 'application_profile', sourceId: profileId, chunkId, content }),
        metadata: { category: 'summary' },
      })
    }

    // 2. Verified Skills
    if (Array.isArray(profile.skills) && profile.skills.length > 0) {
      const content = `Technical Skills: ${profile.skills.join(', ')}`
      const chunkId = `${profileId}_profile_skills`
      chunks.push({
        source_type: 'application_profile',
        source_id: profileId,
        user_id: userId,
        chunk_id: chunkId,
        content,
        content_hash: computeContentHash({ sourceType: 'application_profile', sourceId: profileId, chunkId, content }),
        metadata: { category: 'skills', skill_count: profile.skills.length },
      })
    }

    return chunks
  }

  /**
   * Chunks a job posting into searchable chunks.
   *
   * @param {object} options
   * @param {string} options.jobId - UUID of the job
   * @param {object} options.job - Job posting entity
   * @returns {Array<object>}
   */
  static chunkJob({ jobId, job = {} }) {
    const cleanDesc = this.normalizeText(job.description || '')
    const chunks = []

    // Overview chunk
    const overviewParts = [
      job.title ? `Job Title: ${job.title}` : '',
      job.company ? `Company: ${job.company}` : '',
      job.location ? `Location: ${job.location}` : '',
      job.remote_type ? `Work Mode: ${job.remote_type}` : '',
      job.employment_type ? `Employment Type: ${job.employment_type}` : '',
    ].filter(Boolean)

    const overviewContent = overviewParts.join('\n')
    if (overviewContent) {
      const chunkId = `${jobId}_job_overview`
      chunks.push({
        source_type: 'job',
        source_id: jobId,
        user_id: null,
        chunk_id: chunkId,
        content: overviewContent,
        content_hash: computeContentHash({ sourceType: 'job', sourceId: jobId, chunkId, content: overviewContent }),
        metadata: { category: 'overview' },
      })
    }

    // Description chunks
    if (cleanDesc) {
      const descChunks = this.chunkResume({
        resumeId: jobId,
        userId: null,
        text: cleanDesc,
        chunkSizeWords: 200,
        overlapWords: 40,
      }).map((c, i) => {
        const chunkId = `${jobId}_job_desc_${i}`
        return {
          ...c,
          source_type: 'job',
          chunk_id: chunkId,
          content_hash: computeContentHash({ sourceType: 'job', sourceId: jobId, chunkId, content: c.content }),
          metadata: { category: 'description', ...c.metadata },
        }
      })
      chunks.push(...descChunks)
    }

    return chunks
  }
}
