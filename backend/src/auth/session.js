import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { pool } from '../db.js'
import { sessionCookieName, sessionSecret } from './secrets.js'

const PgSession = connectPgSimple(session)

export function createSessionMiddleware() {
  return session({
    name: sessionCookieName,
    store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: false }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
}