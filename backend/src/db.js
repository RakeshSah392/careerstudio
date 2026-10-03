import dotenv from 'dotenv'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const { Pool } = pg
const connectionString = process.env.DATABASE_URL?.trim()

function missingDatabaseUrlError() {
  return Object.assign(new Error('DATABASE_URL is not configured.'), { code: 'DB_NOT_CONFIGURED' })
}

export const databaseConfigured = Boolean(connectionString)
export const pool = connectionString
  ? new Pool({
      connectionString,
      application_name: 'career-studio-api',
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      max: 10,
    })
  : {
      query: async () => { throw missingDatabaseUrlError() },
      connect: async () => { throw missingDatabaseUrlError() },
      end: async () => {},
    }

export async function checkDatabaseConnection() {
  if (!databaseConfigured) throw missingDatabaseUrlError()
  const result = await pool.query("SELECT current_setting('server_version') AS server_version")
  const serverVersion = result.rows[0].server_version
  return {
    serverVersion,
    majorVersion: Number.parseInt(serverVersion.split('.')[0], 10),
  }
}

if (databaseConfigured) {
  pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error:', error.code ?? 'connection error')
  })
}