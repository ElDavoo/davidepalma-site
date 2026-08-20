/**
 * Dev-server middleware.
 *
 * Eleventy's dev server serves files; the production Go server also resolves
 * wiki-style URLs and answers /search. Without this, `/it/home` would 404 in
 * dev and every link would have to be written twice.
 *
 * URL resolution is reimplemented here (it is a few lines), but search is
 * PROXIED to a real Go server rather than reimplemented -- a second scorer would
 * drift from the one that actually ships, and a search box that behaves
 * differently in dev is worse than no search box.
 */
import fs from 'node:fs'
import path from 'node:path'

const INTERNAL = new Set(['/manifest.json', '/search-index.json'])

export function devMiddleware ({ outputDir, defaultLocale, locales, searchUrl }) {
  return function davidepalmaDevMiddleware (req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)

    // Mirror the production refusal, so a dev build cannot teach you a habit
    // that breaks in production.
    if (INTERNAL.has(pathname) || pathname.startsWith('/_shell/')) {
      res.statusCode = 404
      res.end('not found (this file is server-only in production)')
      return
    }

    if (pathname === '/search') {
      if (!searchUrl) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end('<p>Search needs the Go server. Start the dev loop with <code>npm run dev</code>.</p>')
        return
      }
      proxy(`${searchUrl}${req.url}`, res)
      return
    }

    if (pathname === '/') {
      res.statusCode = 302
      res.setHeader('Location', `/${defaultLocale}/home`)
      res.end()
      return
    }
    const bare = pathname.replace(/^\/|\/$/g, '')
    if (locales.includes(bare)) {
      res.statusCode = 302
      res.setHeader('Location', `/${bare}/home`)
      res.end()
      return
    }

    // Extensionless URL -> <path>.html, as the production server resolves it.
    if (!path.extname(pathname)) {
      const candidate = path.join(outputDir, `${pathname}.html`)
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        req.url = `${encodeURI(`${pathname}.html`)}${url.search}`
      }
    }

    next()
  }
}

async function proxy (target, res) {
  try {
    const upstream = await fetch(target)
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/html; charset=utf-8')
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<p>Search backend unreachable: ${err.message}</p>`)
  }
}
