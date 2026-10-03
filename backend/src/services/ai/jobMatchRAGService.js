/**
 * TechNova Job Application Assistant
 * Step 12.3 — Job Match RAG Service
 * Orchestrates real local retrieval-augmented generation (RAG) for match explanations.
 * ZERO-COST: Ollama all-minilm embeddings + PostgreSQL vector similarity + Ollama Qwen2.5:1.5B LLM.
 */

import { pool } from '../../db.js'
import { applicationProfileService } from '../applicationProfileService.js'
import { scoreJob } from '../matchJobs.js'
import { isUuid } from '../../lib/validation.js'
import { logger } from '../../lib/logger.js'
import { embeddingService } from './embeddingService.js'
import { retrievalService } from './retrievalService.js'
import { ragContextAssembler } from './ragContextAssembler.js'
import { RAGPromptBuilder } from './ragPromptBuilder.js'
import { OllamaLLMProvider } from './providers/ollamaLLMProvider.js'
import { DisabledLLMProvider } from './aiContracts.js'

export const ALLOWED_PRESET_QUESTIONS = [
  'Why am I a good fit for this job?',
  'Which of my skills match the job?',
  'What requirements appear to be missing?',
  'What should I improve before applying?',
]

export class JobMatchRAGService {
  constructor({
    dbPool = pool,
    profileService = applicationProfileService,
    scorer = scoreJob,
    embedder = embeddingService,
    retriever = retrievalService,
    contextAssembler = ragContextAssembler,
    llmProvider = null,
    defaultTopK = 5,
    minSimilarity = 0.25,
  } = {}) {
    this.pool = dbPool
    this.profileService = profileService
    this.scorer = scorer
    this.embedder = embedder
    this.retriever = retriever
    this.contextAssembler = contextAssembler
    this.defaultTopK = defaultTopK
    this.minSimilarity = minSimilarity
    this.defaultProvider = llmProvider || (process.env.AI_PROVIDER === 'disabled'
      ? new DisabledLLMProvider()
      : new OllamaLLMProvider())
  }

  getProvider() {
    return this.defaultProvider
  }

  /**
   * Sanitizes and validates user questions against injection or extreme lengths.
   */
  sanitizeQuestion(rawQuestion) {
    if (!rawQuestion || typeof rawQuestion !== 'string') {
      return ALLOWED_PRESET_QUESTIONS[0]
    }
    const clean = rawQuestion.replace(/[\x00-\x1F\x7F]/g, '').trim()
    if (!clean) return ALLOWED_PRESET_QUESTIONS[0]
    return clean.slice(0, 300)
  }

  /**
   * Ensures the user's profile, primary resume, and target job are indexed in ai_embeddings.
   * Leverages deterministic content hashing so already indexed chunks incur 0 new embedding calls.
   * @private
   */
  async ensureEntitiesIndexed({ userId, jobId, profile, resume, job }) {
    const indexingTasks = []

    if (profile && Object.keys(profile).length > 0) {
      indexingTasks.push(
        this.embedder.embedApplicationProfile({
          profileId: profile.id || userId,
          userId,
          profile,
        }).catch((err) => logger.warn('Failed to index application profile chunks', { error: err.message })),
      )
    }

    if (resume?.content_text) {
      indexingTasks.push(
        this.embedder.embedResume({
          resumeId: resume.id,
          userId,
          text: resume.content_text,
        }).catch((err) => logger.warn('Failed to index resume chunks', { error: err.message })),
      )
    }

    if (job) {
      indexingTasks.push(
        this.embedder.embedJob({
          jobId,
          job,
        }).catch((err) => logger.warn('Failed to index job chunks', { error: err.message })),
      )
    }

    await Promise.all(indexingTasks)
  }

  /**
   * Main Grounded RAG Query Pipeline for Job Match.
   *
   * @param {object} options
   * @param {string} options.userId - Authenticated user UUID
   * @param {string} options.jobId - Target job UUID
   * @param {string} [options.question] - Question to ask about the match
   * @param {number} [options.topK=5] - Number of top chunks to retrieve
   * @param {object} [options.overrideProvider] - Injected provider for testing
   * @returns {Promise<object>}
   */
  async askAboutJobMatch({
    userId,
    jobId,
    question = ALLOWED_PRESET_QUESTIONS[0],
    topK = this.defaultTopK,
    overrideProvider = null,
  }) {
    const startTime = Date.now()
    const latencies = { embedding_ms: 0, retrieval_ms: 0, llm_ms: 0, total_ms: 0 }

    if (!userId || !isUuid(userId)) {
      throw new Error('Valid user ID is required.')
    }
    if (!jobId) {
      throw new Error('Valid job ID is required.')
    }

    const cleanQuestion = this.sanitizeQuestion(question)

    // 1. Fetch Candidate Data (Profile, Preferences, Primary Resume)
    const [profileData, prefResult, resumeResult] = await Promise.all([
      this.profileService.getProfileWithCompleteness(userId),
      this.pool.query('SELECT * FROM job_preferences WHERE user_id = $1 LIMIT 1', [userId]),
      this.pool.query(
        'SELECT id, title, content_text, is_primary FROM resumes WHERE user_id = $1 AND is_primary = true LIMIT 1',
        [userId],
      ),
    ])

    const profile = profileData.profile || {}
    const preferences = prefResult.rows[0] || {}
    const primaryResume = resumeResult.rows[0] || profileData.primaryResume || null

    // 2. Fetch Target Job (Internal recruiter posting first, then external job cache)
    let job = null
    if (isUuid(jobId)) {
      const internalJobRes = await this.pool.query(
        'SELECT id, company, title, location, remote_type, employment_type, industry, description, salary_min, salary_max, currency, status FROM jobs WHERE id = $1',
        [jobId],
      )
      if (internalJobRes.rowCount) {
        job = internalJobRes.rows[0]
      }
    }

    if (!job) {
      const externalJobRes = await this.pool.query(
        'SELECT id, company, title, location, remote_type, employment_type, description, salary_min, salary_max, currency, canonical_url AS source_url FROM external_jobs WHERE id = $1',
        [jobId],
      )
      if (externalJobRes.rowCount) {
        job = externalJobRes.rows[0]
      }
    }

    if (!job) {
      const err = new Error('Job not found.')
      err.status = 404
      throw err
    }

    // 3. Compute Authoritative Deterministic Score (INVARIANT: NEVER OVERWRITTEN)
    const rawScore = this.scorer(job, preferences, profile)
    const deterministicScore = typeof rawScore === 'number' ? rawScore : (rawScore?.score ?? 0)

    const userRoles = Array.isArray(preferences.target_roles) ? preferences.target_roles : []
    const roleMatch = userRoles.some((r) => String(job.title).toLowerCase().includes(String(r).toLowerCase())) ? 100 : 50
    const profileSkills = Array.isArray(profile.skills) ? profile.skills : []
    const matchingSkills = profileSkills.filter((s) => String(job.description || '').toLowerCase().includes(String(s).toLowerCase()))
    const skillsMatch = profileSkills.length > 0 ? Math.round((matchingSkills.length / Math.max(1, profileSkills.length)) * 100) : 50
    const expMatch = profile.years_of_experience != null ? 80 : 50
    const locMatch = (preferences.remote_preference === 'any' || String(job.remote_type).toLowerCase() === String(preferences.remote_preference).toLowerCase()) ? 100 : 60

    const deterministicMatch = {
      score: deterministicScore,
      breakdown: rawScore?.score_breakdown || {
        role: roleMatch,
        skills: skillsMatch,
        experience: expMatch,
        location: locMatch,
      },
    }

    // 4. Ingest and ensure chunks are indexed in PostgreSQL ai_embeddings
    try {
      await this.ensureEntitiesIndexed({ userId, jobId, profile, resume: primaryResume, job })
    } catch (ingestErr) {
      logger.warn('Entity indexing encountered a non-fatal error before retrieval', { error: ingestErr.message })
    }

    // 5. Semantic Vector Retrieval
    let retrievedChunks = []
    const retrievalStart = Date.now()
    try {
      // Build a comprehensive semantic retrieval query
      const searchQuery = `${cleanQuestion} ${job.title} ${job.company} ${(job.description || '').slice(0, 150)}`
      retrievedChunks = await this.retriever.retrieveContext({
        query: searchQuery,
        userId,
        jobId,
        limit: topK,
        minSimilarity: this.minSimilarity,
      })
      latencies.retrieval_ms = Date.now() - retrievalStart
    } catch (retrievalErr) {
      logger.warn('RAG Retrieval failed, returning safe fallback with deterministic score intact', {
        userId,
        jobId,
        error: retrievalErr.message,
      })

      return {
        ok: false,
        code: 'RAG_UNAVAILABLE',
        message: 'Semantic retrieval is currently unavailable. Deterministic match remains active.',
        deterministic_match: deterministicMatch,
        job_id: jobId,
        question: cleanQuestion,
      }
    }

    // 6. Context Assembly with Deduplication and Labeling
    const assembled = this.contextAssembler.assembleContext({
      chunks: retrievedChunks,
      jobMetadata: { title: job.title, company: job.company },
      candidateMetadata: { headline: profile.headline },
    })

    // 7. Grounded Prompt Building
    const promptPayload = RAGPromptBuilder.buildPrompt({
      question: cleanQuestion,
      contextString: assembled.contextString,
      job,
      deterministicScore,
    })

    const provider = overrideProvider || this.defaultProvider

    // 8. Local LLM Inference
    const llmStart = Date.now()
    try {
      const llmResult = await provider.generateAnswer({
        prompt: promptPayload.prompt,
        systemInstruction: promptPayload.systemInstruction,
        context: null, // Context is already cleanly formatted in prompt
        format: 'json',
        temperature: 0.1,
        maxTokens: 350,
      })
      latencies.llm_ms = Date.now() - llmStart

      // 9. Hallucination Control & Citation Validation
      const validatedExplanation = RAGPromptBuilder.parseAndValidateResponse(
        llmResult.text,
        retrievedChunks,
      )

      latencies.total_ms = Date.now() - startTime

      return {
        ok: true,
        job_id: jobId,
        question: cleanQuestion,
        deterministic_match: deterministicMatch,
        rag_explanation: validatedExplanation,
        retrieval_meta: {
          chunks_retrieved: retrievedChunks.length,
          top_similarity: retrievedChunks[0]?.similarity || 0,
          min_similarity: this.minSimilarity,
          sources_count: assembled.sources,
          latency_ms: latencies,
        },
        model: llmResult.model || 'qwen2.5:1.5b',
        provider: typeof provider.getName === 'function' ? provider.getName() : 'ollama',
      }
    } catch (llmErr) {
      logger.warn('Local LLM generation failed during RAG', {
        userId,
        jobId,
        error: llmErr.message,
      })

      return {
        ok: false,
        code: 'AI_UNAVAILABLE',
        message: 'Local AI inference is currently unavailable. Please ensure Ollama is running.',
        deterministic_match: deterministicMatch,
        job_id: jobId,
        question: cleanQuestion,
      }
    }
  }
}

export const jobMatchRAGService = new JobMatchRAGService()
