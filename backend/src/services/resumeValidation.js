import { basename, extname } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import yauzl from 'yauzl'

export const maximumResumeBytes = 10 * 1024 * 1024
const maximumDocxEntries = 5000
const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function invalidResumeError() {
  return Object.assign(new Error('Upload a valid PDF or DOCX resume.'), { code: 'INVALID_RESUME_FILE' })
}

function hasDocxStructure(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, {
      lazyEntries: true,
      autoClose: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error) return resolve(false)
      let entryCount = 0
      let hasContentTypes = false
      let hasDocument = false
      zipFile.on('error', reject)
      zipFile.on('entry', (entry) => {
        entryCount += 1
        if (entryCount > maximumDocxEntries) {
          zipFile.close()
          return resolve(false)
        }
        if (entry.fileName === '[Content_Types].xml') hasContentTypes = true
        if (entry.fileName === 'word/document.xml') hasDocument = true
        zipFile.readEntry()
      })
      zipFile.on('end', () => resolve(hasContentTypes && hasDocument))
      zipFile.readEntry()
    })
  })
}

export async function validateResumeUpload(file) {
  if (!file?.buffer?.length || file.buffer.length > maximumResumeBytes) throw invalidResumeError()
  const sourceFilename = basename(String(file.originalname ?? ''))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 255)
  const extension = extname(sourceFilename).toLowerCase()
  const detected = await fileTypeFromBuffer(file.buffer)

  if (extension === '.pdf' && detected?.mime === 'application/pdf') {
    return { extension: 'pdf', mimeType: 'application/pdf', sourceFilename }
  }
  if (extension === '.docx'
    && ['application/zip', docxMimeType].includes(detected?.mime)
    && await hasDocxStructure(file.buffer)) {
    return { extension: 'docx', mimeType: docxMimeType, sourceFilename }
  }
  throw invalidResumeError()
}