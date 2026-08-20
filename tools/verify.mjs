#!/usr/bin/env node
/**
 * End-to-end verification against a running server.
 *
 * Builds the site/data split the container uses, starts the server, and asserts
 * the properties that matter: URL parity with the old wiki, asset availability,
 * tier enforcement (including a forged X-Auth-Tier), search behaviour, and that
 * no protected content appears anywhere it should not.
 *
 *   node tools/verify.mjs            # builds, starts a server, checks, stops
 *   node tools/verify.mjs --base URL # check an already-running server
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.resolve(import.meta.dirname, '..')
const baseIdx = process.argv.indexOf('--base')
const externalBase = baseIdx > -1 ? process.argv[baseIdx + 1] : null

let passed = 0
const failures = []

function check (name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok    ${name}`) } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function status (base, url, tier) {
  const res = await fetch(base + url, {
    headers: tier === undefined ? {} : { 'X-Auth-Tier': tier },
    redirect: 'manual'
  })
  return res
}

/** Split the build the way the container does: data files outside the web root. */
async function stage () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'davidepalma-verify-'))
  const site = path.join(dir, 'site')
  const data = path.join(dir, 'data')
  await fs.cp(path.join(ROOT, '_site'), site, { recursive: true })
  await fs.mkdir(data, { recursive: true })
  for (const name of ['manifest.json', 'search-index.json']) {
    await fs.rename(path.join(site, name), path.join(data, name))
  }
  await fs.rename(path.join(site, '_shell'), path.join(data, '_shell'))
  return { dir, site, data }
}

async function main () {
  let base = externalBase
  let child = null
  let staged = null

  if (!base) {
    staged = await stage()
    const bin = path.join(staged.dir, 'site-server')
    execFileSync('go', ['build', '-o', bin, '.'], { cwd: path.join(ROOT, 'server'), stdio: 'inherit' })

    const port = 8100 + Math.floor(process.pid % 500)
    base = `http://127.0.0.1:${port}`
    child = spawn(bin, [], {
      env: { ...process.env, SITE_DIR: staged.site, DATA_DIR: staged.data, LISTEN: `127.0.0.1:${port}` },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // Wait for the listener rather than sleeping a fixed amount.
    for (let i = 0; i < 100; i++) {
      try { await fetch(base + '/it/home'); break } catch { await new Promise(r => setTimeout(r, 100)) }
    }
  }

  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, '_site/manifest.json'), 'utf8'))

  // ---- URL parity: nothing the old wiki published may 404 ----
  console.log('\nURL parity (every URL the live wiki serves)')
  const liveUrls = [
    '/it/home', '/it/cose-da-fare', '/it/test', '/it/tips-uni',
    '/it/Università/Università',
    '/it/Università/Triennale/2°_Anno/Basi_di_Dati/domande-teoria-basi',
    '/it/Università/Triennale/2°_Anno/Basi_di_Dati/step_traccia_teoria',
    '/en/home', '/en/spam', '/en/money-jungle-privacy-policy'
  ]
  for (const url of liveUrls) {
    const res = await status(base, encodeURI(url), 'public')
    check(`GET ${url}`, res.status === 200, `got ${res.status}`)
  }
  for (const url of ['/', '/it', '/en']) {
    const res = await status(base, url, 'public')
    check(`GET ${url} redirects to a home page`, res.status === 302 && /\/(it|en)\/home$/.test(res.headers.get('location') || ''),
      `${res.status} -> ${res.headers.get('location')}`)
  }

  // ---- Assets: the case a repo-based build would silently break ----
  console.log('\nAssets')
  for (const url of ['/be862e69f078cd7785139658178f5aaa.png', '/icona_palma.png', '/icona_palma2.png',
    '/senza_titolo.png', '/palm.svg', '/res/senza_titolo.png', '/_assets/site.css', '/_assets/katex.css']) {
    const res = await status(base, url, 'public')
    check(`GET ${url}`, res.status === 200, `got ${res.status}`)
  }

  // ---- Tier enforcement ----
  console.log('\nAccess control')
  const privateUrl = manifest.pages.find(p => p.tier === 'private')?.url
  if (privateUrl) {
    check('private page refused without credentials', (await status(base, privateUrl)).status === 404)
    check('private page refused at public tier', (await status(base, privateUrl, 'public')).status === 404)
    check('private page served at private tier', (await status(base, privateUrl, 'private')).status === 200)
    // Tiers are not a hierarchy: each nginx location serves one prefix.
    check('private page refused with a forged secret header', (await status(base, privateUrl, 'secret')).status === 404)
    const res = await status(base, privateUrl, 'private')
    check('private page carries X-Robots-Tag: noindex',
      (res.headers.get('x-robots-tag') || '').includes('noindex'), res.headers.get('x-robots-tag'))
  }
  check('/secret/unlisted refused at public tier', (await status(base, '/secret/unlisted', 'public')).status === 404)
  check('/secret/unlisted refused with a forged private header', (await status(base, '/secret/unlisted', 'private')).status === 404)
  check('/secret/unlisted served at secret tier', (await status(base, '/secret/unlisted', 'secret')).status === 200)

  console.log('\nBuild data must never be served')
  for (const url of ['/manifest.json', '/search-index.json', '/_shell/search-it.html']) {
    check(`GET ${url} is refused`, (await status(base, url, 'public')).status === 404)
  }

  console.log('\nPath handling')
  check('traversal out of the site directory is refused',
    (await fetch(base + '/../server/main.go', { redirect: 'manual' })).status !== 200)
  check('POST is rejected', (await fetch(base + '/it/home', { method: 'POST' })).status === 405)

  // ---- Search ----
  console.log('\nSearch')
  const search = async (q, lang = 'it') => {
    const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&lang=${lang}`)
    return { status: res.status, html: await res.text() }
  }

  const accented = await search('università')
  check('accented query returns results', /search-result-title/.test(accented.html))
  check('accented query response is valid UTF-8 (no mojibake)', !accented.html.includes('�'),
    'replacement characters present')

  const unaccented = await search('universita')
  check('unaccented query finds the accented page', /search-result-title/.test(unaccented.html))

  check('empty query is handled', (await search('')).status === 200)
  check('no-match query says so', /Nessun risultato|No results/.test((await search('zzzznotathing')).html))

  // Protected pages must never surface in search, for any query.
  const protectedUrls = manifest.pages.filter(p => p.tier !== 'public').map(p => p.url)
  let leaked = null
  for (const q of ['test', 'private', 'privata', 'secret', 'segnaposto', 'placeholder', 'home', 'a', 'e']) {
    const { html } = await search(q)
    for (const url of protectedUrls) {
      if (html.includes(`href="${url}"`)) { leaked = `${url} surfaced for query "${q}"` }
    }
  }
  check('search never surfaces a protected page', leaked === null, leaked ?? '')

  // ---- Protected content must not appear in public HTML ----
  console.log('\nProtected content is absent from public pages')
  const publicPages = manifest.pages.filter(p => p.tier === 'public')
  const protectedPaths = manifest.pages.filter(p => p.tier !== 'public')
  let seen = null
  for (const page of publicPages) {
    const html = await fs.readFile(path.join(ROOT, '_site', page.file), 'utf8')
    for (const prot of protectedPaths) {
      if (html.includes(prot.url)) { seen = `${page.url} mentions ${prot.url}` }
    }
  }
  check('no public page links to a protected one', seen === null, seen ?? '')

  const sitemap = await fs.readFile(path.join(ROOT, '_site/sitemap.xml'), 'utf8')
  check('sitemap lists public pages only',
    protectedPaths.every(p => !sitemap.includes(p.url)) && publicPages.every(p => sitemap.includes(p.url)))

  // ---- Report ----
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (child) { child.kill() }
  if (staged) { await fs.rm(staged.dir, { recursive: true, force: true }) }
  process.exit(failures.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
