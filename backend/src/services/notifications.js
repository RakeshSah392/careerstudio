import { pool } from '../db.js'

/**
 * Creates a persistent notification for a user.
 * Prevents duplicates for the same event and application.
 */
export async function createNotification({
  userId,
  type,
  title,
  message,
  relatedJobId = null,
  relatedApplicationId = null,
}) {
  if (!userId || !type || !title || !message) {
    return null
  }

  // Prevent duplicate notifications for the same application event
  if (relatedApplicationId) {
    const existing = await pool.query(
      `SELECT id FROM notifications 
       WHERE user_id = $1 AND type = $2 AND related_application_id = $3`,
      [userId, type, relatedApplicationId],
    )
    if (existing.rowCount > 0) {
      return existing.rows[0]
    }
  }

  const result = await pool.query(
    `INSERT INTO notifications (
      user_id, type, title, message, related_job_id, related_application_id, is_read
    )
    VALUES ($1, $2, $3, $4, $5, $6, FALSE)
    RETURNING id, user_id, type, title, message, related_job_id, related_application_id, is_read, created_at`,
    [userId, type, title.trim(), message.trim(), relatedJobId, relatedApplicationId],
  )

  return result.rows[0]
}
