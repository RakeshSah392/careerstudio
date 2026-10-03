/**
 * TechNova Job Application Assistant
 * Step 12.1-12.5 — AI Route Endpoints
 * Exposes local LLM job explanation, RAG match analysis, and Kitty career assistant with rate limiting.
 */

import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { jobMatchExplanationService } from '../services/ai/jobMatchExplanationService.js'
import { jobMatchRAGService } from '../services/ai/jobMatchRAGService.js'
import { kittyAssistantService } from '../services/ai/kittyAssistantService.js'
import { isUuid } from '../lib/validation.js'

const router = Router()

// Abuse prevention rate limiter: Max 30 local LLM requests per 10 minutes per user/IP
const aiRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: {
    ok: false,
    code: 'RATE_LIMIT_EXCEEDED',
    error: 'Too many AI requests. Please wait a few moments before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

/**
 * GET /api/ai/status
 * Returns health and configuration status of the local AI provider.
 */
router.get('/status', async (_request, response, next) => {
  try {
    const provider = jobMatchExplanationService.getProvider()
    const health = typeof provider.healthCheck === 'function'
      ? await provider.healthCheck()
      : { available: false, provider: 'none' }
    response.json({ ok: true, health })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/ai/job-explanation
 * Generates factual match explanation for a target job.
 */
router.post('/job-explanation', aiRateLimiter, async (request, response, next) => {
  const { job_id } = request.body ?? {}

  if (!job_id || typeof job_id !== 'string') {
    return response.status(400).json({ error: 'job_id is required and must be a string.' })
  }

  if (!isUuid(job_id)) {
    return response.status(400).json({ error: 'job_id must be a valid UUID.' })
  }

  try {
    const result = await jobMatchExplanationService.explainJobMatch({
      userId: request.user.id,
      jobId: job_id,
    })

    if (!result.ok && result.code === 'AI_UNAVAILABLE') {
      return response.status(503).json(result)
    }

    return response.json(result)
  } catch (err) {
    if (err.status === 404) {
      return response.status(404).json({ error: err.message || 'Job not found.' })
    }
    next(err)
  }
})

/**
 * POST /api/ai/rag/job-match
 * Generates grounded RAG explanation for a target job.
 */
router.post('/rag/job-match', aiRateLimiter, async (request, response, next) => {
  const { job_id, question } = request.body ?? {}

  if (!job_id || typeof job_id !== 'string') {
    return response.status(400).json({ error: 'job_id is required and must be a string.' })
  }

  if (!isUuid(job_id)) {
    return response.status(400).json({ error: 'job_id must be a valid UUID.' })
  }

  try {
    const result = await jobMatchRAGService.askAboutJobMatch({
      userId: request.user.id,
      jobId: job_id,
      question,
    })

    if (!result.ok && (result.code === 'AI_UNAVAILABLE' || result.code === 'RAG_UNAVAILABLE')) {
      return response.status(503).json(result)
    }

    return response.json(result)
  } catch (err) {
    if (err.status === 404) {
      return response.status(404).json({ error: err.message || 'Job not found.' })
    }
    next(err)
  }
})

/**
 * POST /api/ai/kitty
 * Conversational career guidance from Kitty (Step 12.5).
 */
router.post('/kitty', aiRateLimiter, async (request, response, next) => {
  const { message, conversation_id, job_id } = request.body ?? {}

  if (!message || typeof message !== 'string' || !message.trim()) {
    return response.status(400).json({ error: 'message is required and must be a non-empty string.' })
  }

  if (conversation_id && !isUuid(conversation_id)) {
    return response.status(400).json({ error: 'conversation_id must be a valid UUID if provided.' })
  }

  if (job_id && !isUuid(job_id)) {
    return response.status(400).json({ error: 'job_id must be a valid UUID if provided.' })
  }

  try {
    const result = await kittyAssistantService.chat({
      userId: request.user.id,
      message: message.trim(),
      conversationId: conversation_id || null,
      jobId: job_id || null,
    })

    if (!result.ok && result.code === 'AI_UNAVAILABLE') {
      return response.status(503).json(result)
    }

    return response.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/ai/kitty/conversations
 * Lists active conversations for the authenticated user.
 */
router.get('/kitty/conversations', async (request, response, next) => {
  try {
    const conversations = await kittyAssistantService.listConversations(request.user.id)
    return response.json({ ok: true, conversations })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/ai/kitty/conversations/:id/messages
 * Retrieves message history for a conversation owned by the authenticated user.
 */
router.get('/kitty/conversations/:id/messages', async (request, response, next) => {
  const { id } = request.params

  if (!isUuid(id)) {
    return response.status(400).json({ error: 'Invalid conversation ID.' })
  }

  try {
    const messages = await kittyAssistantService.getConversationMessages(id, request.user.id)
    return response.json({ ok: true, messages })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/ai/kitty/conversations/:id
 * Deletes a conversation owned by the authenticated user.
 */
router.delete('/kitty/conversations/:id', async (request, response, next) => {
  const { id } = request.params

  if (!isUuid(id)) {
    return response.status(400).json({ error: 'Invalid conversation ID.' })
  }

  try {
    const deleted = await kittyAssistantService.deleteConversation(id, request.user.id)
    if (!deleted) {
      return response.status(404).json({ error: 'Conversation not found or not owned by user.' })
    }
    return response.json({ ok: true, deleted: true })
  } catch (err) {
    next(err)
  }
})

export default router

