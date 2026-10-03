import assert from 'node:assert/strict'
import test from 'node:test'
import yazl from 'yazl'
import { maximumResumeBytes, validateResumeUpload } from './resumeValidation.js'

function createDocxBuffer() {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const chunks = []
    zip.outputStream.on('data', (chunk) => chunks.push(chunk))
    zip.outputStream.on('error', reject)
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.addBuffer(Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), '[Content_Types].xml')
    zip.addBuffer(Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'), 'word/document.xml')
    zip.end()
  })
}

test('accepts a signature-verified PDF and derives metadata from its filename', async () => {
  const result = await validateResumeUpload({
    originalname: 'candidate.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
  })
  assert.deepEqual(result, {
    extension: 'pdf',
    mimeType: 'application/pdf',
    sourceFilename: 'candidate.pdf',
  })
})

test('accepts DOCX only when the OOXML package entries are present', async () => {
  const result = await validateResumeUpload({
    originalname: 'candidate.docx',
    mimetype: 'application/octet-stream',
    buffer: await createDocxBuffer(),
  })
  assert.equal(result.extension, 'docx')
  assert.equal(result.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
})

test('rejects spoofed, unsupported, and oversized resume uploads', async () => {
  await assert.rejects(
    validateResumeUpload({ originalname: 'fake.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a PDF') }),
    { code: 'INVALID_RESUME_FILE' },
  )
  await assert.rejects(
    validateResumeUpload({ originalname: 'script.exe', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7') }),
    { code: 'INVALID_RESUME_FILE' },
  )
  await assert.rejects(
    validateResumeUpload({ originalname: 'large.pdf', mimetype: 'application/pdf', buffer: Buffer.alloc(maximumResumeBytes + 1) }),
    { code: 'INVALID_RESUME_FILE' },
  )
})