import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = fileURLToPath(new URL('../../.data/resumes/', import.meta.url))
export const resumeStorageRoot = resolve(process.env.RESUME_STORAGE_DIR || defaultRoot)

function resolveResumePath(userId, storageKey) {
  const prefix = `${userId}/`
  if (typeof storageKey !== 'string' || !storageKey.startsWith(prefix)) return null
  const filename = storageKey.slice(prefix.length)
  if (!/^[0-9a-f-]{36}\.(pdf|docx)$/.test(filename)) return null
  const userDirectory = resolve(resumeStorageRoot, userId)
  if (!userDirectory.startsWith(`${resumeStorageRoot}${sep}`)) return null
  const resumePath = resolve(userDirectory, filename)
  return resumePath.startsWith(`${userDirectory}${sep}`) ? resumePath : null
}

export async function storeResumeFile(userId, extension, fileBuffer) {
  const storageKey = `${userId}/${randomUUID()}.${extension}`
  const resumePath = resolveResumePath(userId, storageKey)
  await mkdir(dirname(resumePath), { recursive: true })
  await writeFile(resumePath, fileBuffer, { flag: 'wx', mode: 0o600 })
  return storageKey
}

export async function readResumeFile(userId, storageKey) {
  const resumePath = resolveResumePath(userId, storageKey)
  if (!resumePath) return null
  try {
    return await readFile(resumePath)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function deleteResumeFile(userId, storageKey) {
  const resumePath = resolveResumePath(userId, storageKey)
  if (!resumePath) return
  try {
    await unlink(resumePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}