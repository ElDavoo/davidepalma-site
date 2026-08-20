/**
 * Build-time diagram rendering.
 *
 * wiki.js leaves diagrams to the browser: mermaid fences become
 * <div class="mermaid"> for the client-side Mermaid runtime, and kroki/plantuml
 * fences become <img> tags pointing at kroki.io -- so every page view both
 * requires JavaScript and calls a third party.
 *
 * Here each diagram is rendered once at build time and inlined as SVG. That
 * removes the JavaScript, removes the third-party request (and the referrer leak
 * that comes with it), and makes diagrams work offline and in print.
 *
 * The kroki/plantuml URLs wiki.js emits are self-describing -- the source is a
 * deflate stream in the path -- so we recover it from the <img> rather than
 * threading token metadata through the pipeline. That also picks up any <img>
 * pointing at a kroki server that someone wrote by hand.
 */
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const CACHE_DIR = path.resolve(process.env.DIAGRAM_CACHE || '.cache/diagrams')

/** Reverse of wiki.js's kroki encoding: base64url of a zlib-deflated source. */
function decodeKrokiUrl (src) {
  const m = /^https?:\/\/[^/]+\/([A-Za-z0-9_-]+)\/(?:svg|png|jpeg|pdf|txt|base64)\/(.+)$/.exec(src)
  if (!m) { return null }
  try {
    const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/')
    return { type: m[1], source: zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8') }
  } catch {
    return null
  }
}

/** Reverse of the PlantUML alphabet: raw-deflate under a custom base64. */
function decodePlantumlUrl (src) {
  const m = /^https?:\/\/[^/]+\/(?:svg|png|txt)\/([A-Za-z0-9_-]+)$/.exec(src)
  if (!m) { return null }
  try {
    return { type: 'plantuml', source: zlib.inflateRawSync(decode64(m[1])).toString('utf8') }
  } catch {
    return null
  }
}

function decode64 (str) {
  const val = (c) => {
    const b = (c ?? '0').charCodeAt(0)
    if (b >= 48 && b <= 57) { return b - 48 }        // 0-9
    if (b >= 65 && b <= 90) { return b - 65 + 10 }   // A-Z
    if (b >= 97 && b <= 122) { return b - 97 + 36 }  // a-z
    if (c === '-') { return 62 }
    if (c === '_') { return 63 }
    return 0
  }
  const out = []
  for (let i = 0; i < str.length; i += 4) {
    const c1 = val(str[i]); const c2 = val(str[i + 1])
    const c3 = val(str[i + 2]); const c4 = val(str[i + 3])
    out.push(((c1 << 2) | (c2 >> 4)) & 0xFF, ((c2 << 4) | (c3 >> 2)) & 0xFF, ((c3 << 6) | c4) & 0xFF)
  }
  return Buffer.from(out)
}

/**
 * Render one diagram, caching by content hash so an unchanged diagram never hits
 * the network twice -- important because CI rebuilds on every content push.
 */
async function renderDiagram (type, source, opts) {
  const key = crypto.createHash('sha256').update(`${type} ${source}`).digest('hex')
  const cacheFile = path.join(CACHE_DIR, `${key}.svg`)
  const failFile = path.join(CACHE_DIR, `${key}.failed`)

  try {
    return await fs.readFile(cacheFile, 'utf8')
  } catch { /* not cached yet */ }

  // Remember failures too, but only in lenient mode. Without this, an author
  // whose Kroki is unreachable pays the full timeout on every save, which makes
  // the hot-reload loop unusable. CI runs strict and always tries for real, so a
  // stale failure can never reach a published image. Delete .cache/diagrams to
  // retry.
  if (!opts.strict) {
    let cachedFailure = null
    try {
      cachedFailure = await fs.readFile(failFile, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') { throw err }
    }
    if (cachedFailure !== null) {
      throw new Error(`${cachedFailure} [cached; delete .cache/diagrams to retry]`)
    }
  }

  const url = `${opts.server.replace(/\/$/, '')}/${type}/svg`
  const attempts = opts.retries ?? Number(process.env.DIAGRAM_RETRIES ?? 3)

  // Kroki's heavier backends (mermaid runs a headless browser) are slow to warm
  // up and intermittently 5xx. Retrying beats failing a whole deploy on one
  // cold start -- but we still fail rather than publish a broken diagram.
  let svg
  let lastErr
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: source,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30000)
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      svg = await res.text()
      break
    } catch (err) {
      lastErr = err
      if (attempt < attempts) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
  }
  if (svg === undefined) {
    const message = `kroki ${type} -> ${lastErr.message} (after ${attempts} attempts)`
    if (!opts.strict) {
      await fs.mkdir(CACHE_DIR, { recursive: true })
      await fs.writeFile(failFile, message)
    }
    throw new Error(message)
  }

  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(cacheFile, svg)
  return svg
}

/** Strip the XML prologue and give the SVG an accessible name. */
function prepareSvg (svg, { type, alt }) {
  const out = svg
    .replace(/^﻿/, '')
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/<!DOCTYPE[^>]*>\s*/i, '')
    .trim()
    .replace(/<svg\b([^>]*)>/i, (full, attrs) => {
      let a = attrs
      if (!/\brole=/.test(a)) { a += ' role="img"' }
      if (alt && !/\baria-label=/.test(a)) { a += ` aria-label="${alt.replace(/"/g, '&quot;')}"` }
      return `<svg${a}>`
    })

  return `<figure class="diagram diagram-${type}">${out}</figure>`
}

/**
 * cheerio transform: replace every diagram placeholder with inline SVG.
 *
 * @param {object} opts
 * @param {string} opts.server   Kroki base URL
 * @param {boolean} opts.strict  throw on failure (CI) instead of warning (dev)
 */
export function inlineDiagrams (opts = {}) {
  const server = opts.server || process.env.KROKI_SERVER || 'https://kroki.io'
  const strict = opts.strict ?? (process.env.NODE_ENV === 'production')

  return async function inlineDiagramsTransform ($, ctx) {
    const jobs = []

    // 1. Mermaid fences -- wiki.js's html-mermaid target, resolved here instead.
    $('pre > code.language-mermaid').each((i, elm) => {
      jobs.push({ node: $(elm).parent(), type: 'mermaid', source: $(elm).text(), alt: 'mermaid diagram' })
    })

    // 2. kroki / plantuml <img> tags emitted by the markdown fences.
    $('img').each((i, elm) => {
      const src = $(elm).attr('src') || ''
      if (!/^https?:\/\//.test(src)) { return }
      const decoded = decodeKrokiUrl(src) || decodePlantumlUrl(src)
      if (!decoded) { return }
      jobs.push({
        node: $(elm),
        type: decoded.type,
        source: decoded.source,
        alt: $(elm).attr('alt') || `${decoded.type} diagram`
      })
    })

    for (const job of jobs) {
      try {
        const svg = await renderDiagram(job.type, job.source, { server, timeoutMs: opts.timeoutMs, strict })
        job.node.replaceWith(prepareSvg(svg, job))
      } catch (err) {
        const where = ctx?.page ? `${ctx.page.localeCode}/${ctx.page.path}` : 'unknown page'
        const msg = `[diagram] ${job.type} on ${where}: ${err.message}`
        if (strict) { throw new Error(msg) }
        console.warn(`${msg} -- leaving the source visible`)
        job.node.replaceWith(
          `<figure class="diagram diagram-error"><pre><code>${$('<div>').text(job.source).html()}</code></pre>` +
          '<figcaption>Diagram could not be rendered at build time.</figcaption></figure>'
        )
      }
    }
  }
}

export const _internals = { decodeKrokiUrl, decodePlantumlUrl }
