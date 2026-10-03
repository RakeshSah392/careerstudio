import 'dotenv/config'
import { pool } from './db.js'
import { createApp } from './app.js'

const port = Number(process.env.PORT) || 4000
const server = createApp().listen(port, () => {
  console.log(`Job application API listening on http://localhost:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().finally(() => process.exit(0)))
  })
}