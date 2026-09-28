import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

type MeteringReportServer = {
  url: string
  close: () => Promise<void>
}

function openReportUrl(url: string, run: typeof execFile = execFile): Promise<void> {
  return new Promise((resolve, reject) => {
    run('open', [url], (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function startMeteringReportServer(html: string): Promise<MeteringReportServer> {
  const path = `/${randomUUID()}`
  let host = ''
  const server = createServer((request, response) => {
    if (request.headers.host !== host || request.url !== path) {
      response.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    if (request.method !== 'GET') {
      response.writeHead(405, {
        Allow: 'GET',
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      })
      response.end('Method not allowed')
      return
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      Connection: 'close',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    })
    response.end(html)
  })

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('The report server did not receive a local TCP address.'))
        return
      }

      host = `127.0.0.1:${address.port}`
      let closePromise: Promise<void> | undefined
      const close = (): Promise<void> => {
        if (closePromise) return closePromise
        closePromise = new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error)
            else resolveClose()
          })
        })
        return closePromise
      }
      resolve({ url: `http://${host}${path}`, close })
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

export { type MeteringReportServer, openReportUrl, startMeteringReportServer }
