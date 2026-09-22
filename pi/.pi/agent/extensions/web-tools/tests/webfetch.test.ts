import assert from 'node:assert/strict'
import test from 'node:test'
import { createWebFetchTool } from '../index.ts'
import {
  acceptHeaderForFormat,
  assertSafePublicHttpUrl,
  previewLines as webFetchPreviewLines,
} from '../src/core/webfetch.ts'
import { convertHTMLToMarkdown, extractTextFromHTML } from '../src/html.ts'

test('webfetch blocks localhost and private IPv4', () => {
  assert.throws(() => assertSafePublicHttpUrl('http://localhost'))
  assert.throws(() => assertSafePublicHttpUrl('http://127.0.0.1'))
  assert.throws(() => assertSafePublicHttpUrl('http://192.168.1.10'))
  assert.doesNotThrow(() => assertSafePublicHttpUrl('https://example.com'))
})

test('html helpers return readable text and markdown', () => {
  const html = '<html><body><h1>Hello</h1><p>World</p><script>bad()</script></body></html>'
  assert.match(extractTextFromHTML(html), /Hello/)
  assert.match(extractTextFromHTML(html), /World/)
  assert.doesNotMatch(extractTextFromHTML(html), /bad/)
  assert.match(convertHTMLToMarkdown(html), /# Hello/)
  assert.match(convertHTMLToMarkdown(html), /World/)
})

test('webfetch accept headers vary by format', () => {
  assert.match(acceptHeaderForFormat('markdown'), /text\/markdown/)
  assert.match(acceptHeaderForFormat('text'), /text\/plain/)
  assert.match(acceptHeaderForFormat('html'), /text\/html/)
})

test('webfetch preview lines trim blanks and truncate long lines', () => {
  assert.deepEqual(webFetchPreviewLines('\n first line \n\nsecond line\nthird line\nfourth line', 3, 20), [
    'first line',
    'second line',
    'third line',
  ])
  assert.deepEqual(webFetchPreviewLines('abcdefghijklmnopqrstuvwxyz', 3, 8), ['abcdefg…'])
})

test('webfetch preserves URL policy and tool schema', () => {
  //given
  const webFetchTool = createWebFetchTool(async () => {
    throw new Error('test runner must not execute the webfetch workflow')
  })
  const parameters = webFetchTool.parameters as {
    required: string[]
    properties: Record<string, { enum?: string[]; description?: string }>
  }

  //when
  const schema = {
    name: webFetchTool.name,
    required: parameters.required,
    formats: parameters.properties.format.enum,
    timeoutDescription: parameters.properties.timeout.description,
  }

  //then
  assert.deepEqual(schema, {
    name: 'webfetch',
    required: ['url'],
    formats: ['text', 'markdown', 'html'],
    timeoutDescription: 'Timeout in seconds. Default 30, max 120',
  })
  assert.throws(() => assertSafePublicHttpUrl('ftp://example.com'), /URL must use http:\/\/ or https:\/\//)
  assert.throws(() => assertSafePublicHttpUrl('https://api.localhost'), /Blocked private or localhost target/)
  assert.doesNotThrow(() => assertSafePublicHttpUrl('http://169.254.169.254'))
})
