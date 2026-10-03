import { checkDatabaseConnection, databaseConfigured, pool } from './db.js'

try {
  if (!databaseConfigured) {
    console.error('DATABASE_URL is not configured. Set it in the repository root .env or process environment.')
    process.exitCode = 1
  } else {
    const { serverVersion, majorVersion } = await checkDatabaseConnection()
    if (majorVersion !== 18) {
      console.error(`Connected to PostgreSQL ${serverVersion}; this project expects PostgreSQL 18.`)
      process.exitCode = 1
    } else {
      console.log(`PostgreSQL 18 connection OK (${serverVersion}).`)
    }
  }
} catch (error) {
  const code = error.code ? ` (${error.code})` : ''
  console.error(`PostgreSQL connection failed${code}. Check DATABASE_URL and local server availability.`)
  process.exitCode = 1
} finally {
  await pool.end()
}