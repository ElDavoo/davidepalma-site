#!/usr/bin/env node
/** Render a single exported page through the site pipeline, for eyeballing. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { renderMarkdown } from '../src/markdown/pipeline.mjs'
import { renderHtmlCore } from '../src/postprocess/html-core.mjs'
import { siteChildren } from '../src/postprocess/children-site.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const [locale, ...rest] = process.argv[2].split('/')
const pagePath = rest.join('/')

const raw = await fs.readFile(path.join(ROOT, 'export/content', locale, `${pagePath}.md`), 'utf8')
const body = raw.replace(/^---\n[\s\S]*?\n---\n\n?/, '')

const { html, headings } = await renderHtmlCore(renderMarkdown(body), {
  page: { localeCode: locale, path: pagePath },
  knownPages: new Set(JSON.parse(await fs.readFile(path.join(ROOT, 'export/manifest.json'), 'utf8'))
    .pages.map(p => `${p.locale}/${p.path}`)),
  children: siteChildren({ diagrams: { strict: false } })
})

const out = process.argv[3]
if (out) { await fs.writeFile(out, html); console.error(`wrote ${out} (${html.length} bytes, ${headings.length} headings)`) } else { console.log(html) }
