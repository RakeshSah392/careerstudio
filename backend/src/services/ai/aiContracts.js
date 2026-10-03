/**
 * AI & RAG Extension Boundary Contracts
 * 
 * Defines standard interfaces and adapters for future LLM and RAG integrations.
 * Core business logic strictly depends on these abstractions, not on any proprietary SDKs.
 */

export class LLMProviderInterface {
  async generateAnswer({ prompt, context, systemInstruction }) {
    throw new Error('LLMProviderInterface.generateAnswer must be implemented by an adapter.')
  }

  async healthCheck() {
    throw new Error('LLMProviderInterface.healthCheck must be implemented by an adapter.')
  }
}

export class EmbeddingProviderInterface {
  async embedText(text) {
    throw new Error('EmbeddingProviderInterface.embedText must be implemented by an adapter.')
  }

  async embedBatch(texts) {
    throw new Error('EmbeddingProviderInterface.embedBatch must be implemented by an adapter.')
  }
}

export class RetrievalServiceInterface {
  async retrieveContext({ query, userId, jobId, limit = 5 }) {
    throw new Error('RetrievalServiceInterface.retrieveContext must be implemented by an adapter.')
  }
}

export class DisabledLLMProvider extends LLMProviderInterface {
  async generateAnswer() {
    return {
      available: false,
      answer: null,
      status: 'disabled',
      reason: 'No LLM provider configured.',
    }
  }

  async healthCheck() {
    return { available: false, provider: 'none' }
  }
}

/**
 * Authoritative Context Assembler for future RAG / LLM tasks.
 * Pulls authoritative data directly from existing PostgreSQL entities without duplicating storage.
 */
export class RAGContextAssembler {
  assembleCandidateContext({ profile, resume, preferences, job }) {
    return {
      profile: profile ? {
        headline: profile.headline,
        currentJobTitle: profile.current_job_title,
        skills: profile.skills,
        experienceLevel: profile.experience_level,
        yearsOfExperience: profile.years_of_experience,
        expectedSalary: profile.expected_salary,
        currency: profile.salary_currency,
        workAuthorization: profile.work_authorization,
        joiningStatus: profile.joining_status,
      } : null,
      resume: resume ? {
        title: resume.title,
        sourceFilename: resume.source_filename,
        hasTextContent: Boolean(resume.content_text),
        storageKey: resume.storage_key,
      } : null,
      preferences: preferences ? {
        targetRoles: preferences.target_roles,
        locations: preferences.locations,
        remotePreference: preferences.remote_preference,
        employmentTypes: preferences.employment_types,
      } : null,
      job: job ? {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        remoteType: job.remote_type,
        description: job.description,
      } : null,
      assembledAt: new Date().toISOString(),
    }
  }
}

export class AIService {
  constructor({
    llmProvider = new DisabledLLMProvider(),
    contextAssembler = new RAGContextAssembler(),
  } = {}) {
    this.llmProvider = llmProvider
    this.contextAssembler = contextAssembler
  }

  isAvailable() {
    return !(this.llmProvider instanceof DisabledLLMProvider)
  }

  async generateAnswer({ question, profile, resume, job }) {
    const context = this.contextAssembler.assembleCandidateContext({
      profile,
      resume,
      job,
    })

    return this.llmProvider.generateAnswer({
      prompt: question,
      context,
      systemInstruction: 'Generate a professional application answer based strictly on the candidate profile and resume.',
    })
  }
}

export const aiService = new AIService()
