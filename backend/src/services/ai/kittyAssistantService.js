/**
 * TechNova Job Application Assistant
 * Step 12.5 — Kitty AI Career Assistant Service
 * Orchestrates grounded conversational guidance for job seekers using local RAG and Ollama.
 * 100% ZERO-COST Local AI: Ollama (all-minilm embeddings + Qwen2.5:1.5B LLM) + PostgreSQL.
 */

import { pool } from '../../db.js'
import { isUuid } from '../../lib/validation.js'
import { logger } from '../../lib/logger.js'
import { applicationProfileService } from '../applicationProfileService.js'
import { scoreJob } from '../matchJobs.js'
import { embeddingService } from './embeddingService.js'
import { retrievalService } from './retrievalService.js'
import { ragContextAssembler } from './ragContextAssembler.js'
import { KittyPromptBuilder } from './kittyPromptBuilder.js'
import { kittyRepository } from '../../repositories/kittyRepository.js'
import { OllamaLLMProvider } from './providers/ollamaLLMProvider.js'
import { DisabledLLMProvider } from './aiContracts.js'

export class KittyAssistantService {
  constructor({
    dbPool = pool,
    profileService = applicationProfileService,
    embedder = embeddingService,
    retriever = retrievalService,
    contextAssembler = ragContextAssembler,
    repository = kittyRepository,
    scorer = scoreJob,
    llmProvider = null,
    defaultTopK = 4,
    minSimilarity = 0.25,
  } = {}) {
    this.pool = dbPool
    this.profileService = profileService
    this.embedder = embedder
    this.retriever = retriever
    this.contextAssembler = contextAssembler
    this.repository = repository
    this.scorer = scorer
    this.defaultTopK = defaultTopK
    this.minSimilarity = minSimilarity
    this.defaultProvider = llmProvider || (process.env.AI_PROVIDER === 'disabled'
      ? new DisabledLLMProvider()
      : new OllamaLLMProvider({ timeoutMs: 90000 }))
  }

  getProvider() {
    return this.defaultProvider
  }

  /**
   * Sanitizes user question.
   */
  sanitizeMessage(rawMessage) {
    if (!rawMessage || typeof rawMessage !== 'string') {
      return 'How can I improve my job applications?'
    }
    const clean = rawMessage.replace(/[\x00-\x1F\x7F]/g, '').trim()
    return clean.slice(0, 1000)
  }

  /**
   * Ensures candidate and job data are indexed in ai_embeddings with content-hash reuse.
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
        }).catch((err) => logger.warn('Failed to index profile chunks for Kitty', { error: err.message })),
      )
    }

    if (resume?.content_text) {
      indexingTasks.push(
        this.embedder.embedResume({
          resumeId: resume.id,
          userId,
          text: resume.content_text,
        }).catch((err) => logger.warn('Failed to index resume chunks for Kitty', { error: err.message })),
      )
    }

    if (job) {
      indexingTasks.push(
        this.embedder.embedJob({
          jobId,
          job,
        }).catch((err) => logger.warn('Failed to index job chunks for Kitty', { error: err.message })),
      )
    }

    await Promise.all(indexingTasks)
  }

  /**
   * Main conversational interaction method for Kitty.
   *
   * @param {object} options
   * @param {string} options.userId - Authenticated user UUID
   * @param {string} options.message - User prompt or question
   * @param {string|null} [options.conversationId=null] - Optional conversation UUID
   * @param {string|null} [options.jobId=null] - Optional target job UUID for contextual queries
   * @param {object|null} [options.overrideProvider=null] - Injected provider for testing
   * @returns {Promise<object>}
   */
  async chat({
    userId,
    message,
    conversationId = null,
    jobId = null,
    overrideProvider = null,
  }) {
    if (!userId || !isUuid(userId)) {
      throw new Error('Valid authenticated user ID is required.')
    }

    const cleanMessage = this.sanitizeMessage(message)
    if (!cleanMessage) {
      throw new Error('Message cannot be empty.')
    }

    // 1. Resolve or Create Conversation
    let conversation = null
    if (conversationId && isUuid(conversationId)) {
      conversation = await this.repository.getConversation(conversationId, userId)
    }

    if (!conversation) {
      // Derive a short conversation title from the first message
      const title = cleanMessage.length > 40 ? `${cleanMessage.slice(0, 37)}...` : cleanMessage
      conversation = await this.repository.createConversation({
        userId,
        title,
      })
    }

    // Save candidate user message
    await this.repository.createMessage({
      conversationId: conversation.id,
      userId,
      role: 'user',
      content: cleanMessage,
    })

    // 2. Fetch Recent Conversation History for Context
    const recentMessages = await this.repository.listMessages(conversation.id, userId, 6)

    // 3. Fetch Candidate Data (Profile, Preferences, Primary Resume)
    const [profileData, prefResult, resumeResult] = await Promise.all([
      this.profileService.getProfileWithCompleteness(userId),
      this.pool.query('SELECT * FROM job_preferences WHERE user_id = $1 LIMIT 1', [userId]),
      this.pool.query(
        'SELECT id, title, content_text, is_primary FROM resumes WHERE user_id = $1 AND is_primary = true LIMIT 1',
        [userId],
      ),
    ])

    const profile = profileData?.profile || {}
    const preferences = prefResult.rows[0] || {}
    const primaryResume = resumeResult.rows[0] || profileData?.primaryResume || null

    // 4. Fetch Target Job if provided
    let job = null
    let deterministicScore = null

    if (jobId && isUuid(jobId)) {
      // Check internal jobs first
      const internalJobRes = await this.pool.query(
        'SELECT id, company, title, location, remote_type, employment_type, industry, description, salary_min, salary_max, currency, status FROM jobs WHERE id = $1',
        [jobId],
      )

      if (internalJobRes.rowCount) {
        job = internalJobRes.rows[0]
      } else {
        // Check external jobs cache
        const extJobRes = await this.pool.query(
          'SELECT id, company, title, location, remote_type, employment_type, industry, description_snippet as description, salary_min, salary_max, salary_currency as currency FROM external_jobs WHERE id = $1',
          [jobId],
        )
        if (extJobRes.rowCount) {
          job = extJobRes.rows[0]
        }
      }

      if (job) {
        const matchResult = this.scorer(job, preferences)
        deterministicScore = matchResult.score
      }
    }

    // 5. Index entities if needed
    await this.ensureEntitiesIndexed({
      userId,
      jobId: job?.id || null,
      profile,
      resume: primaryResume,
      job,
    })

    // 6. Semantic Retrieval from PostgreSQL Vector Storage
    let retrievedChunks = []
    try {
      if (job?.id) {
        retrievedChunks = await this.retriever.retrieveContext({
          query: cleanMessage,
          userId,
          jobId: job.id,
          limit: this.defaultTopK,
          minSimilarity: this.minSimilarity,
        })
      } else {
        // Candidate-only query (resume and profile)
        retrievedChunks = await this.retriever.retrieveCandidateContext({
          query: cleanMessage,
          userId,
          limit: this.defaultTopK,
          minSimilarity: this.minSimilarity,
        }).catch(async () => {
          // Fallback to direct search if helper not present
          const simChunks = await this.embedder.searchSimilar({
            queryText: cleanMessage,
            userId,
            limit: this.defaultTopK,
            minSimilarity: this.minSimilarity,
          })
          return simChunks
        })
      }
    } catch (retrievalErr) {
      logger.warn('Kitty semantic retrieval warning', { error: retrievalErr.message })
      retrievedChunks = []
    }

    // 7. Assemble Grounded Context
    const assembled = this.contextAssembler.assembleContext({
      chunks: retrievedChunks,
      jobMetadata: job ? { title: job.title, company: job.company } : null,
      candidateMetadata: { headline: profile.headline || 'Job Seeker' },
    })

    // 8. Build Grounded Prompt
    const promptPayload = KittyPromptBuilder.buildPrompt({
      message: cleanMessage,
      contextString: assembled.contextString,
      job,
      matchScore: deterministicScore,
      recentMessages: recentMessages.slice(-4),
    })

    const provider = overrideProvider || this.defaultProvider

    // 9. Generate Kitty Response via Local LLM
    try {
      const llmResult = await provider.generateAnswer({
        prompt: promptPayload.prompt,
        systemInstruction: promptPayload.systemInstruction,
        context: null,
        temperature: 0.2,
        maxTokens: 350,
      })

      const rawAnswer = String(llmResult?.text || '').trim()
      const answer = rawAnswer || 'Hello! I am Kitty, your CareerStudio AI Assistant. How can I help with your job search today?'
      const sources = KittyPromptBuilder.formatSourceBadges(retrievedChunks)

      // Save assistant response message to conversation
      const assistantMessage = await this.repository.createMessage({
        conversationId: conversation.id,
        userId,
        role: 'assistant',
        content: answer,
        sources,
      })

      return {
        ok: true,
        assistant: 'Kitty',
        conversation_id: conversation.id,
        message_id: assistantMessage.id,
        answer,
        sources,
        deterministic_match: deterministicScore != null ? { score: deterministicScore } : null,
        model: llmResult.model || 'qwen2.5:1.5b',
        provider: typeof provider.getName === 'function' ? provider.getName() : 'ollama',
      }
    } catch (llmErr) {
      logger.warn('Local LLM generation failed for Kitty chat', {
        userId,
        error: llmErr.message,
      })

      return {
        ok: false,
        code: 'AI_UNAVAILABLE',
        message: 'Kitty is currently resting because the local AI service is unavailable. Please verify Ollama is running at http://127.0.0.1:11434.',
        conversation_id: conversation.id,
      }
    }
  }

  /**
   * Lists all conversations for a user.
   */
  async listConversations(userId) {
    if (!userId || !isUuid(userId)) return []
    return this.repository.listConversations(userId)
  }

  /**
   * Gets message history for a conversation.
   */
  async getConversationMessages(conversationId, userId) {
    if (!conversationId || !isUuid(conversationId) || !userId || !isUuid(userId)) {
      return []
    }
    return this.repository.listMessages(conversationId, userId)
  }

  /**
   * Deletes a conversation.
   */
  async deleteConversation(conversationId, userId) {
    if (!conversationId || !isUuid(conversationId) || !userId || !isUuid(userId)) {
      return false
    }
    return this.repository.deleteConversation(conversationId, userId)
  }
}

export const kittyAssistantService = new KittyAssistantService()

