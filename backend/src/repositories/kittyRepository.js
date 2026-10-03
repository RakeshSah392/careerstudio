/**
 * TechNova Job Application Assistant
 * Step 12.5 — Kitty AI Conversation Repository
 * Data access layer for Kitty career assistant conversations and messages.
 */

import { pool } from '../db.js'

export async function ensureKittySchema(dbPool = pool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS kitty_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS kitty_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES kitty_conversations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      sources JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_kitty_conv_user ON kitty_conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kitty_msg_conv ON kitty_messages(conversation_id, created_at ASC);
  `)
}

export class KittyRepository {
  constructor(dbPool = pool) {
    this.pool = dbPool
  }

  async ensureSchema() {
    return ensureKittySchema(this.pool)
  }

  /**
   * Creates a new conversation for a user.
   */
  async createConversation({ userId, title = 'New Conversation' }) {
    await this.ensureSchema()
    const cleanTitle = String(title || 'New Conversation').trim().slice(0, 255)
    const result = await this.pool.query(
      `INSERT INTO kitty_conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, user_id, title, created_at, updated_at`,
      [userId, cleanTitle],
    )
    return result.rows[0]
  }

  /**
   * Lists all conversations for a user ordered by most recently updated.
   */
  async listConversations(userId) {
    await this.ensureSchema()
    const result = await this.pool.query(
      `SELECT id, user_id, title, created_at, updated_at
       FROM kitty_conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId],
    )
    return result.rows
  }

  /**
   * Retrieves a single conversation by ID, enforcing user ownership.
   */
  async getConversation(conversationId, userId) {
    await this.ensureSchema()
    const result = await this.pool.query(
      `SELECT id, user_id, title, created_at, updated_at
       FROM kitty_conversations
       WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    )
    return result.rows[0] || null
  }

  /**
   * Updates conversation title and timestamp.
   */
  async updateConversation(conversationId, userId, { title = null } = {}) {
    await this.ensureSchema()
    const fields = ['updated_at = NOW()']
    const values = [conversationId, userId]

    if (title && typeof title === 'string') {
      values.push(title.trim().slice(0, 255))
      fields.push(`title = $${values.length}`)
    }

    const result = await this.pool.query(
      `UPDATE kitty_conversations
       SET ${fields.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, title, created_at, updated_at`,
      values,
    )
    return result.rows[0] || null
  }

  /**
   * Deletes a conversation by ID, enforcing user ownership.
   */
  async deleteConversation(conversationId, userId) {
    await this.ensureSchema()
    const result = await this.pool.query(
      `DELETE FROM kitty_conversations
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [conversationId, userId],
    )
    return Boolean(result.rowCount)
  }

  /**
   * Appends a message to a conversation.
   */
  async createMessage({ conversationId, userId, role, content, sources = [] }) {
    await this.ensureSchema()
    const cleanContent = String(content || '').trim()
    const safeSources = Array.isArray(sources) ? JSON.stringify(sources) : '[]'

    const result = await this.pool.query(
      `INSERT INTO kitty_messages (conversation_id, user_id, role, content, sources)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, conversation_id, user_id, role, content, sources, created_at`,
      [conversationId, userId, role, cleanContent, safeSources],
    )

    // Bump conversation updated_at
    await this.pool.query(
      'UPDATE kitty_conversations SET updated_at = NOW() WHERE id = $1',
      [conversationId],
    )

    return result.rows[0]
  }

  /**
   * Lists messages for a conversation, enforcing user ownership.
   */
  async listMessages(conversationId, userId, limit = 50) {
    await this.ensureSchema()
    // Verify conversation ownership first
    const conv = await this.getConversation(conversationId, userId)
    if (!conv) return []

    const boundedLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)))
    const result = await this.pool.query(
      `SELECT id, conversation_id, user_id, role, content, sources, created_at
       FROM kitty_messages
       WHERE conversation_id = $1 AND user_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [conversationId, userId, boundedLimit],
    )
    return result.rows
  }
}

export const kittyRepository = new KittyRepository()

