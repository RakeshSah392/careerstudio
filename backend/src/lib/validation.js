export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim())
}

export function isOptionalString(value) {
  return value === undefined || typeof value === 'string'
}