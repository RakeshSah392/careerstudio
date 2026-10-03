import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = fileURLToPath(new URL('../../.data/profile-images/', import.meta.url))
export const profileImageRoot = resolve(process.env.PROFILE_IMAGE_DIR || defaultRoot)

function resolveImagePath(userId, storageKey) {
  const prefix = `${userId}/`
  if (typeof storageKey !== 'string' || !storageKey.startsWith(prefix)) return null
  const filename = storageKey.slice(prefix.length)
  if (!/^[0-9a-f-]{36}\.webp$/.test(filename)) return null
  const userDirectory = resolve(profileImageRoot, userId)
  if (!userDirectory.startsWith(`${profileImageRoot}${sep}`)) return null
  const imagePath = resolve(userDirectory, filename)
  return imagePath.startsWith(`${userDirectory}${sep}`) ? imagePath : null
}

export async function storeProfileImage(userId, imageBuffer) {
  const storageKey = `${userId}/${randomUUID()}.webp`
  const imagePath = resolveImagePath(userId, storageKey)
  await mkdir(dirname(imagePath), { recursive: true })
  await writeFile(imagePath, imageBuffer, { flag: 'wx', mode: 0o600 })
  return storageKey
}

export async function readProfileImage(userId, storageKey) {
  const imagePath = resolveImagePath(userId, storageKey)
  if (!imagePath) return null
  try {
    return await readFile(imagePath)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function deleteProfileImage(userId, storageKey) {
  const imagePath = resolveImagePath(userId, storageKey)
  if (!imagePath) return
  try {
    await unlink(imagePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}