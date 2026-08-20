#!/usr/bin/env node
/**
 * Build-time link checker: internal links, images and #anchors.
 *
 * Resolves against the built output rather than the source, so it catches
 * anything the pipeline drops as well as anything an author mistyped.
 *
 *   node tools/check-links.mjs [siteDir]
 *
 * Exits non-zero on broken links. `--warn` reports without failing.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as cheerio from 'cheerio'

const SITE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '_site')
const warnOnly = process.argv.includes('--warn')

/**
 * --redact-protected replaces private, secret and unlisted paths in the output
 * with a tier label. CI runs on a public repository, so its logs are public, and
 * a broken link inside a protected page would otherwise publish that page's
 * address. The tier and the reason are still reported.
 */
const redactProtected = process.argv.includes('--redact-protected')
let redact = (s) => s
if (redactProtected) {
  const manifest = JSON.parse(await fs.readFile(path.join(SITE, 'manifest.json'), 'utf8'))
  const rules = manifest.pages
    .filter(p => p.tier !== 'public')
    .sort((a, b) => b.url.length - a.url.length)
    .map(p => [p.url, `<${p.tier} page>`])
  redact = (text) => rules.reduce((acc, [from, to]) => acc.split(from).join(to), String(text))
}

async function* walk (dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { yield* walk(full) } else { yield full }
  }
}

// Every path the server can resolve, plus the anchors each page defines.
const files = new Set()
const anchors = new Map()
const htmlFiles = []

for await (const file of walk(SITE)) {
  const rel = '/' + path.relative(SITE, file).split(path.sep).join('/')
  files.add(rel)
  if (rel.endsWith('.html')) {
    files.add(rel.replace(/\.html$/, ''))       // extensionless, as the server resolves it
    files.add(rel.replace(/\/index\.html$/, '')) // directory form
    htmlFiles.push(file)
  }
}

for (const file of htmlFiles) {
  const rel = '/' + path.relative(SITE, file).split(path.sep).join('/')
  const $ = cheerio.load(await fs.readFile(file, 'utf8'))
  const ids = new Set()
  $('[id]').each((i, e) => ids.add($(e).attr('id')))
  anchors.set(rel.replace(/\.html$/, ''), ids)
}

const problems = []

for (const file of htmlFiles) {
  const rel = '/' + path.relative(SITE, file).split(path.sep).join('/')
  const from = rel.replace(/\.html$/, '')
  const $ = cheerio.load(await fs.readFile(file, 'utf8'))

  const check = (raw, kind) => {
    if (!raw) { return }
    // External, protocol-relative, and non-http schemes are out of scope.
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) { return }
    // The search shell carries template placeholders, not real URLs.
    if (raw.includes('{{')) { return }

    let target = raw
    let hash = ''
    const hashIdx = raw.indexOf('#')
    if (hashIdx >= 0) { target = raw.slice(0, hashIdx); hash = raw.slice(hashIdx + 1) }

    if (target === '') {
      // Same-page anchor.
      if (hash && !anchors.get(from)?.has(decodeURIComponent(hash))) {
        problems.push(`${from}: #${hash} does not exist on this page`)
      }
      return
    }

    const resolved = decodeURIComponent(target.startsWith('/') ? target : path.posix.join(path.posix.dirname(from), target))

    // /search and the locale roots are served by the Go server, not by a file.
    if (resolved === '/search' || /^\/[a-z]{2}$/.test(resolved) || resolved === '/') { return }

    if (!files.has(resolved)) {
      problems.push(`${from}: ${kind} -> ${raw} (no such page or asset)`)
      return
    }
    if (hash && anchors.has(resolved) && !anchors.get(resolved).has(decodeURIComponent(hash))) {
      problems.push(`${from}: ${raw} — page exists but #${hash} does not`)
    }
  }

  $('a[href]').each((i, e) => check($(e).attr('href'), 'link'))
  $('img[src]').each((i, e) => check($(e).attr('src'), 'image'))
  $('link[href]').each((i, e) => check($(e).attr('href'), 'stylesheet'))
}

if (problems.length) {
  const unique = [...new Set(problems.map(redact))].sort()
  console[warnOnly ? 'warn' : 'error'](`${warnOnly ? 'WARN' : 'FAIL'} — ${unique.length} broken link(s):`)
  for (const p of unique) { console[warnOnly ? 'warn' : 'error'](`  ${p}`) }
  if (!warnOnly) { process.exit(1) }
} else {
  console.log(`OK — ${htmlFiles.length} pages, no broken internal links or anchors`)
}
