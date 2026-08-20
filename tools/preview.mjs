#!/usr/bin/env node
/**
 * Bundle one built page into a single self-contained HTML file.
 *
 * Inlines the stylesheets, the KaTeX web fonts and every image, so the result
 * can be opened straight from disk and still looks exactly like the deployed
 * page. Useful for showing someone the rendering before anything is deployed.
 *
 *   node tools/preview.mjs <siteDir> <page.html> <out.html>
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const [siteDir, pageRel, outFile] = process.argv.slice(2)
if (!siteDir || !pageRel || !outFile) {
  console.error('usage: node tools/preview.mjs <siteDir> <page.html> <out.html>')
  process.exit(1)
}

const SITE = path.resolve(siteDir)
const mime = (f) => ({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
})[path.extname(f).toLowerCase()] ?? 'application/octet-stream'

async function dataUri (rel) {
  const file = path.join(SITE, rel.replace(/^\//, ''))
  const buf = await fs.readFile(file)
  return `data:${mime(file)};base64,${buf.toString('base64')}`
}

let html = await fs.readFile(path.join(SITE, pageRel), 'utf8')

// Stylesheets -> inline <style>. KaTeX's font URLs are relative to the
// stylesheet, so they are resolved against /_assets/ before embedding. Only
// woff2 is kept: every browser that matters supports it, and carrying woff and
// ttf as well would triple the size for nothing.
for (const href of ['/_assets/site.css', '/_assets/katex.css']) {
  let css = await fs.readFile(path.join(SITE, href.replace(/^\//, '')), 'utf8')

  const faces = [...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map(m => m[1])
  for (const font of [...new Set(faces)]) {
    css = css.replaceAll(`url(${font})`, `url(${await dataUri(`_assets/${font}`)})`)
  }
  // Drop the woff/ttf fallbacks, whose relative URLs would now dangle.
  css = css.replace(/,\s*url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '')

  html = html.replace(new RegExp(`<link rel="stylesheet" href="${href}">`), `<style>\n${css}\n</style>`)
}

// Images -> data URIs.
for (const m of [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:png|jpe?g|gif|svg|ico))"/g)]) {
  try {
    html = html.replaceAll(`"${m[1]}"`, `"${await dataUri(m[1])}"`)
  } catch {
    console.warn(`[preview] missing asset ${m[1]}`)
  }
}

await fs.writeFile(outFile, html)
const { size } = await fs.stat(outFile)
console.log(`${outFile} — ${(size / 1024).toFixed(0)} KB, self-contained`)
