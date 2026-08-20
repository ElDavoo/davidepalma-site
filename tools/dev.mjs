#!/usr/bin/env node
/**
 * The authoring loop.
 *
 * Runs the production search backend beside Eleventy's dev server, so editing a
 * markdown file in VS Code and saving it re-renders through the real pipeline
 * with the real stylesheet, and the browser reloads itself. `{.is-info}`,
 * tabsets, KaTeX and diagrams all look exactly as they will in production --
 * which VS Code's built-in markdown preview cannot show you.
 *
 * Every tier is served unauthenticated here, behind a visible banner, so private
 * and secret pages are editable locally.
 *
 *   npm run dev            ->  http://localhost:8080
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SEARCH_PORT = Number(process.env.DEV_SEARCH_PORT) || 8081
const SITE_PORT = Number(process.env.PORT) || 8080

function startSearchBackend () {
  const bin = path.join(ROOT, '.cache', 'site-server-dev')
  fs.mkdirSync(path.dirname(bin), { recursive: true })

  const build = spawnSync('go', ['build', '-o', bin, '.'], {
    cwd: path.join(ROOT, 'server'),
    stdio: 'inherit'
  })
  if (build.status !== 0) {
    console.warn('\n[dev] could not build the search backend; /search will be unavailable.\n')
    return null
  }

  // The dev server has no site/data split: everything is still in _site.
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      SITE_DIR: path.join(ROOT, '_site'),
      DATA_DIR: path.join(ROOT, '_site'),
      LISTEN: `127.0.0.1:${SEARCH_PORT}`,
      DEV_MODE: '1'
    },
    stdio: ['ignore', 'ignore', 'inherit']
  })
  child.on('exit', code => {
    if (code) { console.warn(`[dev] search backend exited (${code}); /search will be unavailable`) }
  })
  return child
}

// The backend reads _site at startup, so build once before starting it.
console.log('[dev] building once so the search backend has an index…')
const first = spawnSync('npx', ['@11ty/eleventy'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ELEVENTY_RUN_MODE: 'build', DIAGRAMS_STRICT: process.env.DIAGRAMS_STRICT ?? '0' }
})
if (first.status !== 0) { process.exit(first.status ?? 1) }

const backend = startSearchBackend()

const eleventy = spawn('npx', ['@11ty/eleventy', '--serve', `--port=${SITE_PORT}`], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, DEV_SEARCH_URL: `http://127.0.0.1:${SEARCH_PORT}` }
})

const stop = () => {
  backend?.kill()
  eleventy.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
eleventy.on('exit', code => { backend?.kill(); process.exit(code ?? 0) })
