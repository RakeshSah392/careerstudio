/**
 * TechNova Job Application Assistant
 * Step 12.1 — Local Ollama LLM Provider Adapter
 * Communicates with local Ollama service and normalizes responses into provider-neutral format.
 */

import { LLMProviderInterface } from '../aiContracts.js'
import { logger } from '../../../lib/logger.js'

export class OllamaLLMProvider extends LLMProviderInterface {
  constructor({
    baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b',
    timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 45000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    super()
    this.baseUrl = String(baseUrl).replace(/\/$/, '')
    this.model = String(model)
    this.timeoutMs = Number(timeoutMs) || 45000
    this.fetchImpl = fetchImpl
  }

  getName() {
    return 'ollama'
  }

  getModel() {
    return this.model
  }

  async healthCheck() {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        return { available: false, provider: 'ollama', status: response.status }
      }
      const data = await response.json()
      const hasModel = Array.isArray(data?.models) && data.models.some((m) => {
        const name = String(m.name || '').toLowerCase()
        const target = this.model.toLowerCase()
        return name === target || name.startsWith(`${target}:`) || target.startsWith(`${name}:`)
      })
      return {
        available: true,
        provider: 'ollama',
        model: this.model,
        modelLoaded: Boolean(hasModel),
      }
    } catch (err) {
      return { available: false, provider: 'ollama', error: err.message }
    }
  }

  /**
   * Generates a completion from the local Ollama instance.
   *
   * @param {object} options
   * @param {string} options.prompt - Prompt or user message
   * @param {string} [options.systemInstruction] - System prompt instructions
   * @param {object|string} [options.context] - Structured context data
   * @param {string} [options.format] - Output format e.g. 'json'
   * @param {number} [options.temperature=0.2]
   * @returns {Promise<{ text: string, model: string, usage: { prompt_tokens: number|null, completion_tokens: number|null, total_tokens: number|null } }>}
   */
  async generateAnswer({
    prompt,
    systemInstruction = '',
    context = null,
    format = null,
    temperature = 0.2,
    maxTokens = 350,
  }) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('prompt is required and must be a string.')
    }

    const messages = []
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction })
    }

    let userContent = prompt
    if (context) {
      const contextStr = typeof context === 'string' ? context : JSON.stringify(context, null, 2)
      userContent = `${prompt}\n\nCandidate & Job Context:\n${contextStr}`
    }
    messages.push({ role: 'user', content: userContent })

    const requestBody = {
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: typeof temperature === 'number' ? temperature : 0.2,
        num_predict: typeof maxTokens === 'number' ? maxTokens : 350,
        num_ctx: 2048,
      },
    }

    if (format === 'json') {
      requestBody.format = 'json'
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Ollama chat request failed with status ${response.status}: ${errorText}`)
      }

      const data = await response.json()
      const rawText = data?.message?.content || ''

      const promptTokens = Number.isInteger(data?.prompt_eval_count) ? data.prompt_eval_count : null
      const completionTokens = Number.isInteger(data?.eval_count) ? data.eval_count : null
      const totalTokens = (promptTokens != null && completionTokens != null) ? promptTokens + completionTokens : null

      return {
        text: rawText,
        model: data?.model || this.model,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        },
      }
    } catch (err) {
      logger.warn('Ollama LLM request failed', {
        model: this.model,
        error: err.message,
        isTimeout: err.name === 'TimeoutError' || err.name === 'AbortError',
      })
      throw err
    }
  }
}
