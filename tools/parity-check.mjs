#!/usr/bin/env node
/**
 * Diff our rendering against wiki.js's own `pages.render` output.
 *
 * This is the objective check the earlier Hugo attempt never had: if the port
 * drifts from what davidepalma.it currently serves, this fails.
 *
 * Compares a normalised DOM (attributes sorted, whitespace collapsed) rather
 * than raw bytes, because cheerio, jsdom and DOMPurify each serialise attribute
 * order differently without changing meaning.
 *
 *   node tools/parity-check.mjs [--verbose] [--only <substring>]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as cheerio from 'cheerio'

import { renderMarkdown } from '../src/markdown/pipeline.mjs'
import { renderHtmlCore } from '../src/postprocess/html-core.mjs'
import { wikijsChildren } from '../src/postprocess/children-wikijs.mjs'
import { contentSources } from '../src/sources.mjs'
import { _internals as diagramInternals } from '../src/postprocess/diagrams.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const EXPORT = path.join(ROOT, 'export')
const verbose = process.argv.includes('--verbose')
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null

/**
 * Collapse the differences that are serialisation noise, not rendering changes.
 *
 * One of these is substantive enough to spell out: wiki.js runs its output
 * through DOMPurify (html-security), whose MathML allow-list drops KaTeX's
 * <semantics>/<annotation> wrapper -- the element that carries the original
 * LaTeX for screen readers and copy-paste. We keep it, so the fixtures lack a
 * subtree our output has. Unwrapping it here models exactly what DOMPurify did,
 * leaving any *real* difference inside the math still visible to the diff.
 */
function normalise (html) {
  const $ = cheerio.load(html, { decodeEntities: true })

  // Unwrap, don't remove: DOMPurify drops a disallowed element but keeps its
  // text children, so the fixture still carries the raw LaTeX as a bare text node.
  $('annotation').each((i, elm) => { $(elm).replaceWith($(elm).contents()) })
  $('semantics').each((i, elm) => { $(elm).replaceWith($(elm).contents()) })

  // KaTeX's .katex-html subtree is presentation, not content: it is a visual
  // rendering of the same parse the MathML above it describes, and its internal
  // class names and rounded lengths change between KaTeX releases (0.18 renamed
  // `base` to `katex-base` and shortened style values). We ship KaTeX's own
  // matching stylesheet, so those changes are invisible on the page. The MathML
  // beside it IS compared in full, so a real change to the mathematics still
  // fails this check.
  $('.katex-html').html('[katex presentation layer]')

  // A kroki/plantuml URL carries a deflate stream, and zlib emits different
  // (equally valid) bytes depending on the build -- so the same diagram encodes
  // differently on a developer machine and on a CI runner. Compare what the URL
  // *means*: decode it and canonicalise to type + source.
  $('img').each((i, elm) => {
    const src = $(elm).attr('src') || ''
    const decoded = diagramInternals.decodeKrokiUrl(src) || diagramInternals.decodePlantumlUrl(src)
    if (decoded) {
      $(elm).attr('src', `diagram:${decoded.type}:${Buffer.from(decoded.source).toString('base64')}`)
    }
  })

  const walk = (node) => {
    if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
      if (node.attribs) {
        const sorted = {}
        for (const k of Object.keys(node.attribs).sort()) {
          // Boolean-ish attributes serialise as "" or "true" depending on the writer.
          sorted[k] = node.attribs[k] === 'true' ? '' : node.attribs[k]
        }
        node.attribs = sorted
      }
    }
    if (node.type === 'text') {
      node.data = node.data.replace(/\s+/g, ' ')
    }
    for (const child of node.children ?? []) { walk(child) }
  }
  for (const node of $.root().children()) { walk(node) }

  return $.html('body')
    .replace(/^<body>|<\/body>$/g, '')
    .replace(/>\s+</g, '><')
    .trim()
}

/**
 * Differences from wiki.js that are intended.
 *
 * Kept as an explicit, justified list rather than normalised away silently: each
 * entry is a place where our output is deliberately NOT what the wiki serves,
 * and that should be visible to anyone reading this file.
 */
const EXPECTED_DIFFERENCES = [
  {
    page: 'it/test',
    description:
      'mhchem now works. On the live wiki, $\\ce {CO2 + C -> 2 CO}$ fails to parse ' +
      '(KaTeX 0.12 with the vendored mhchem) and the page shows the literal text "\\ce". ' +
      'Current KaTeX renders the equation. Ours is the correct output; the fixture ' +
      'records a bug.',
    want: /^<p>\\ce<\/p>/,
    got: /^<p><span class="katex"/
  }
]

/** Split into comparable chunks so a diff points at the offending element. */
function chunks (html) {
  return normalise(html).split(/(?=<(?:h[1-6]|p|div|ul|ol|pre|blockquote|table|img|tabset|hr)[ >])/)
}

/**
 * Where to read a page's markdown.
 *
 * Prefer the content repository: that is the file the site is actually built
 * from, so checking it proves the *shipping* source still renders identically.
 * export/content is the migration snapshot and only exists locally -- it is
 * gitignored, because the markdown belongs in the content repos, not here.
 */
async function sourceFor (page) {
  const candidates = [
    ...contentSources(ROOT).map(s => path.join(s.dir, page.locale, `${page.path}.md`)),
    path.join(EXPORT, page.source)
  ]
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch { /* try the next */ }
  }
  throw new Error(`no markdown found for ${page.locale}/${page.path}; tried:\n  ${candidates.join('\n  ')}`)
}

async function main () {
  const manifest = JSON.parse(await fs.readFile(path.join(EXPORT, 'manifest.json'), 'utf8'))
  const knownPages = new Set(manifest.pages.map(p => `${p.locale}/${p.path}`))

  let pass = 0
  const failures = []

  for (const page of manifest.pages) {
    if (only && !`${page.locale}/${page.path}`.includes(only)) { continue }

    const raw = await fs.readFile(await sourceFor(page), 'utf8')
    const body = raw.replace(/^---\n[\s\S]*?\n---\n\n?/, '')
    const expected = await fs.readFile(path.join(EXPORT, page.fixture), 'utf8')

    const md = renderMarkdown(body)
    const { html } = await renderHtmlCore(md, {
      page: { localeCode: page.locale, path: page.path },
      knownPages,
      children: wikijsChildren,
      vueCompat: true
    })

    const got = normalise(html)
    const want = normalise(expected)

    if (got === want) {
      pass++
      console.log(`  PASS  ${page.locale}/${page.path}`)
    } else {
      const g = chunks(html)
      const w = chunks(expected)
      const diffs = []
      const expectedHere = []
      for (let i = 0; i < Math.max(g.length, w.length); i++) {
        if (g[i] === w[i]) { continue }
        const known = EXPECTED_DIFFERENCES.find(e =>
          e.page === `${page.locale}/${page.path}` &&
          e.want.test(w[i] ?? '') && e.got.test(g[i] ?? ''))
        if (known) { expectedHere.push(known); continue }
        diffs.push({ i, want: w[i], got: g[i] })
      }

      for (const e of new Set(expectedHere)) {
        console.log(`  note  ${page.locale}/${page.path}: ${e.description}`)
      }

      if (diffs.length === 0) {
        pass++
        console.log(`  PASS  ${page.locale}/${page.path} (with ${expectedHere.length} intended difference(s))`)
        continue
      }

      failures.push({ page, diffs })
      console.log(`  FAIL  ${page.locale}/${page.path}  (${diffs.length} differing chunk(s) of ${Math.max(g.length, w.length)})`)
      const show = verbose ? diffs : diffs.slice(0, 3)
      for (const d of show) {
        console.log(`        [${d.i}] want: ${String(d.want).slice(0, 220)}`)
        console.log(`        [${d.i}]  got: ${String(d.got).slice(0, 220)}`)
      }
      if (!verbose && diffs.length > 3) { console.log(`        ... ${diffs.length - 3} more (--verbose)`) }
    }
  }

  console.log(`\n${pass} passed, ${failures.length} failed`)
  process.exit(failures.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
