#!/usr/bin/env node
/**
 * Assert the build ships no client-side JavaScript.
 *
 * This is the project's central constraint, so it is checked mechanically
 * rather than trusted: a stray <script> would be easy to add and hard to notice.
 *
 *   node tools/check-no-js.mjs [siteDir]
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const SITE = path.resolve(process.argv[2] || '_site')

// Attributes that execute script if present at all.
const EVENT_ATTR = /\son[a-z]+\s*=/i
const SCRIPT_TAG = /<script\b/i
const JS_URL = /(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i

async function* walk (dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { yield* walk(full) } else { yield full }
  }
}

const failures = []
let checked = 0

for await (const file of walk(SITE)) {
  if (!/\.(html|svg)$/i.test(file)) { continue }
  const rel = path.relative(SITE, file)
  const content = await fs.readFile(file, 'utf8')
  checked++

  // Inlined diagram SVGs come from Kroki and are not ours; they must be clean too.
  if (SCRIPT_TAG.test(content)) { failures.push(`${rel}: contains a <script> tag`) }
  if (EVENT_ATTR.test(content)) {
    const m = content.match(new RegExp(`.{0,60}${EVENT_ATTR.source}.{0,40}`, 'i'))
    failures.push(`${rel}: inline event handler — ${m?.[0].trim()}`)
  }
  if (JS_URL.test(content)) { failures.push(`${rel}: javascript: URL`) }
}

if (failures.length) {
  console.error(`FAIL — client-side JavaScript found in ${failures.length} place(s):`)
  for (const f of failures) { console.error(`  ${f}`) }
  process.exit(1)
}

console.log(`OK — ${checked} HTML/SVG files, no <script>, no inline handlers, no javascript: URLs`)
