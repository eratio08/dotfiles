import assert from 'node:assert/strict'
import type { execFile } from 'node:child_process'
import test from 'node:test'
import { openReportUrl, startMeteringReportServer } from '../src/report-server.ts'

test('should serve report HTML over a private loopback URL given generated HTML', async () => {
  //given
  const html = '<!doctype html><title>metered report</title>'
  const reportServer = await startMeteringReportServer(html)

  try {
    //when
    const response = await fetch(reportServer.url)

    //then
    assert.match(reportServer.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}$/)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(await response.text(), html)
  } finally {
    await reportServer.close()
  }
})

test('should hide report HTML at an unknown route given a running server', async () => {
  //given
  const reportServer = await startMeteringReportServer('<p>sensitive report</p>')

  try {
    //when
    const response = await fetch(new URL('/unknown', reportServer.url))

    //then
    assert.equal(response.status, 404)
    assert.doesNotMatch(await response.text(), /sensitive report/)
  } finally {
    await reportServer.close()
  }
})

test('should reject non-GET requests given a valid report URL', async () => {
  //given
  const reportServer = await startMeteringReportServer('<p>sensitive report</p>')

  try {
    //when
    const response = await fetch(reportServer.url, { method: 'POST' })

    //then
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assert.doesNotMatch(await response.text(), /sensitive report/)
  } finally {
    await reportServer.close()
  }
})

test('should stop accepting requests given a closed report server', async () => {
  //given
  const reportServer = await startMeteringReportServer('<p>report</p>')

  //when
  await reportServer.close()

  //then
  await assert.rejects(fetch(reportServer.url))
})

test('should pass the report URL as one argument to macOS open given a browser URL', async () => {
  //given
  const url = 'http://127.0.0.1:43127/3f24df4f-8bdd-4f90-8ca3-63431dbf44ad'
  let command = ''
  let args: readonly string[] = []
  const run = ((commandArg: string, arguments_: string[], callback: (error: Error | null) => void): void => {
    command = commandArg
    args = arguments_
    callback(null)
  }) as unknown as typeof execFile

  //when
  await openReportUrl(url, run)

  //then
  assert.equal(command, 'open')
  assert.deepEqual(args, [url])
})
