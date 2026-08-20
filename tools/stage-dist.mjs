#!/usr/bin/env node
/**
 * Split the Eleventy output into what the container serves and what only the
 * server reads.
 *
 *   dist/site   the web root
 *   dist/data   manifest.json, search-index.json, the search shells
 *
 * manifest.json names every page in every tier, so serving it would list the
 * private and secret URLs to anyone. The server refuses those paths, but
 * keeping the files outside the web root means two independent mistakes would
 * have to line up before they could leak.
 *
 *   node tools/stage-dist.mjs [--in _site] [--out dist]
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const DATA_FILES = ['manifest.json', 'search-index.json']
const DATA_DIRS = ['_shell']

export async function stageDist (inDir, outDir) {
  const site = path.join(outDir, 'site')
  const data = path.join(outDir, 'data')

  await fs.rm(outDir, { recursive: true, force: true })
  await fs.cp(inDir, site, { recursive: true })
  await fs.mkdir(data, { recursive: true })

  for (const name of DATA_FILES) {
    await fs.rename(path.join(site, name), path.join(data, name))
  }
  for (const name of DATA_DIRS) {
    await fs.rename(path.join(site, name), path.join(data, name))
  }
  return { site, data }
}

if (import.meta.filename === process.argv[1]) {
  const arg = (flag, fallback) => {
    const i = process.argv.indexOf(flag)
    return i > -1 ? process.argv[i + 1] : fallback
  }
  const inDir = path.resolve(arg('--in', '_site'))
  const outDir = path.resolve(arg('--out', 'dist'))
  const { site, data } = await stageDist(inDir, outDir)
  console.log(`staged ${inDir} -> ${site} (web root) + ${data} (server only)`)
}
