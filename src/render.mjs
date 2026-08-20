/**
 * Render the loaded pages: markdown -> html-core -> the no-JavaScript transforms.
 *
 * Results are cached on disk, content-addressed, because the authoring loop
 * rebuilds every page on every save: without this, editing one line means
 * waiting for KaTeX and cheerio to reprocess a 47 KB maths-heavy page that did
 * not change. The cache key covers everything that can alter a page's output --
 * its body, its identity, the pipeline version, and the set of pages that exist
 * (which decides is-valid-page / is-invalid-page on internal links) -- so a
 * stale hit is not possible without one of those changing.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { createMarkdownIt } from './markdown/pipeline.mjs'
import { renderHtmlCore } from './postprocess/html-core.mjs'
import { siteChildren } from './postprocess/children-site.mjs'
import { knownPageKeys } from './content.mjs'
import { config } from './config.mjs'

// Bump when the pipeline changes in a way that alters output.
const PIPELINE_VERSION = '1'

const CACHE_DIR = path.resolve(process.env.RENDER_CACHE || '.cache/render')

function cacheKey (page, fingerprint) {
  return crypto.createHash('sha256')
    .update(PIPELINE_VERSION).update('\0')
    .update(page.locale).update('\0')
    .update(page.path).update('\0')
    .update(page.tier).update('\0')
    .update(fingerprint).update('\0')
    .update(page.body)
    .digest('hex')
}

export async function renderPages (pages, opts = {}) {
  const md = createMarkdownIt(config)
  const knownPages = knownPageKeys(pages)
  const children = siteChildren({ diagrams: opts.diagrams })
  const useCache = opts.cache !== false

  // One fingerprint for the whole page set: link validity depends on it.
  const fingerprint = crypto.createHash('sha256')
    .update([...knownPages].sort().join('\n'))
    .digest('hex')

  const rendered = []
  let hits = 0

  for (const page of pages) {
    const key = cacheKey(page, fingerprint)
    const cacheFile = path.join(CACHE_DIR, `${key}.json`)

    if (useCache) {
      try {
        const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
        rendered.push({ ...page, ...cached })
        hits++
        continue
      } catch { /* miss */ }
    }

    const { html, headings, internalRefs } = await renderHtmlCore(md.render(page.body), {
      page: { localeCode: page.locale, path: page.path },
      knownPages,
      children,
      vueCompat: false,
      config
    })

    // Do not cache a page whose diagram fell back to its source. The cache key
    // covers the content, not the state of the diagram renderer, so a page
    // cached while Kroki was unreachable would keep showing the fallback long
    // after Kroki came back -- and clearing .cache/diagrams would not help,
    // because this cache would still answer first.
    const hadDiagramFailure = html.includes('diagram-error')
    if (useCache && !hadDiagramFailure) {
      await fs.mkdir(CACHE_DIR, { recursive: true })
      await fs.writeFile(cacheFile, JSON.stringify({ html, headings, internalRefs }))
    }
    rendered.push({ ...page, html, headings, internalRefs })
  }

  return { pages: rendered, cacheHits: hits }
}
