#!/usr/bin/env node
/**
 * One-shot exporter: live WikiJS Postgres -> markdown tree + assets + parity fixtures.
 *
 * The git repo (ElDavoo/wikijs-content) is stale and lossy -- it is missing the
 * four root-level assets and carries a duplicated/stale `home.md`. The database is
 * the only faithful source, so the migration exports from there.
 *
 * Reaches Postgres through ssh + `docker exec psql`, which is how the Pi exposes it.
 *
 *   WIKIJS_SSH_HOST=user@host node tools/export-wikijs.mjs [--out DIR]
 *
 * Env: WIKIJS_SSH_HOST (required), WIKIJS_PG_CONTAINER, WIKIJS_PG_USER, WIKIJS_PG_DB
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const SSH_HOST = process.env.WIKIJS_SSH_HOST
const CONTAINER = process.env.WIKIJS_PG_CONTAINER || 'docker-postgres-1'
const PG_USER = process.env.WIKIJS_PG_USER || 'wikijs'
const PG_DB = process.env.WIKIJS_PG_DB || 'wikijs'

if (!SSH_HOST) {
  console.error('Set WIKIJS_SSH_HOST (user@host of the machine running the wiki\'s Postgres).')
  process.exit(2)
}

const outArg = process.argv.indexOf('--out')
const OUT = path.resolve(outArg > -1 ? process.argv[outArg + 1] : 'export')

/** Run one SQL statement remotely, returning its single JSON value. */
function queryJson (sql) {
  const script = `\\pset format unaligned\n\\pset tuples_only on\n${sql}\n`
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [
      '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', SSH_HOST,
      `sudo -n docker exec -i ${CONTAINER} psql -q -U ${PG_USER} -d ${PG_DB} -f -`
    ], { stdio: ['pipe', 'pipe', 'inherit'] })
    const chunks = []
    child.stdout.on('data', c => chunks.push(c))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`psql over ssh exited ${code}`))
      const out = Buffer.concat(chunks).toString('utf8').trim()
      try { resolve(out ? JSON.parse(out) : []) } catch (e) { reject(e) }
    })
    child.stdin.end(script)
  })
}

const PAGES_SQL = `
SELECT json_agg(row_to_json(t)) FROM (
  SELECT p.id, p."localeCode", p.path, p.title, p.description,
         p."isPrivate", p."isPublished", p."contentType", p."editorKey",
         p."createdAt", p."updatedAt", p.content, p.render, p.toc,
         (SELECT coalesce(json_agg(tg.tag ORDER BY pt.id), '[]'::json)
            FROM "pageTags" pt JOIN tags tg ON tg.id = pt."tagId"
           WHERE pt."pageId" = p.id) AS tags
    FROM pages p
   ORDER BY p."localeCode", p.path
) t;`

// assetFolders is a parent-linked tree; walk it to materialise full folder paths.
const ASSETS_SQL = `
WITH RECURSIVE fp AS (
  SELECT id, slug::text AS path FROM "assetFolders" WHERE "parentId" IS NULL
  UNION ALL
  SELECT f.id, fp.path || '/' || f.slug FROM "assetFolders" f JOIN fp ON f."parentId" = fp.id
)
SELECT json_agg(row_to_json(t)) FROM (
  SELECT a.id, a.filename, a.ext, a.mime, a."fileSize",
         coalesce(fp.path, '') AS folder,
         a."createdAt", a."updatedAt",
         encode(ad.data, 'base64') AS b64
    FROM assets a
    LEFT JOIN fp ON fp.id = a."folderId"
    LEFT JOIN "assetData" ad ON ad.id = a.id
   ORDER BY a.id
) t;`

/**
 * Reproduce the frontmatter WikiJS's own git storage module writes, so exported
 * files are byte-compatible with what the wiki has been committing.
 */
function frontmatter (page) {
  return [
    '---',
    `title: ${page.title}`,
    `description: ${page.description || ''}`,
    `published: ${page.isPublished ? 'true' : 'false'}`,
    `date: ${page.updatedAt}`,
    `tags: ${page.tags.join(', ')}`,
    `editor: ${page.editorKey}`,
    `dateCreated: ${page.createdAt}`,
    '---',
    '',
    ''
  ].join('\n')
}

function assertSafe (rel, what) {
  const norm = path.normalize(rel)
  if (path.isAbsolute(norm) || norm.split(path.sep).includes('..')) {
    throw new Error(`refusing unsafe ${what} path: ${rel}`)
  }
  return norm
}

async function writeFileMkdir (file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, data)
}

async function main () {
  console.log(`exporting from ${SSH_HOST}:${CONTAINER}/${PG_DB} -> ${OUT}`)
  const [pages, assets] = await Promise.all([queryJson(PAGES_SQL), queryJson(ASSETS_SQL)])

  const manifest = { exportedAt: new Date().toISOString(), pages: [], assets: [] }

  for (const page of pages) {
    // Normalise to an explicit {locale}/{path} layout for BOTH locales. WikiJS
    // wrote the default locale unprefixed (alwaysNamespace: false), which is what
    // left a stale `it/home.md` beside an authoritative root `home.md` in git.
    const rel = assertSafe(path.join(page.localeCode, `${page.path}.md`), 'page')
    const body = page.content ?? ''
    await writeFileMkdir(path.join(OUT, 'content', rel), frontmatter(page) + body.replace(/\r\n/g, '\n'))

    // WikiJS's own rendered HTML: the golden fixtures for parity checking.
    const fixture = assertSafe(path.join(page.localeCode, `${page.path}.html`), 'fixture')
    await writeFileMkdir(path.join(OUT, 'fixtures', fixture), page.render ?? '')

    manifest.pages.push({
      id: page.id,
      locale: page.localeCode,
      path: page.path,
      title: page.title,
      description: page.description || '',
      tags: page.tags,
      isPrivate: page.isPrivate,
      isPublished: page.isPublished,
      contentType: page.contentType,
      editorKey: page.editorKey,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      toc: page.toc,
      source: `content/${rel}`,
      fixture: `fixtures/${fixture}`,
      url: `/${page.localeCode}/${page.path}`
    })
    console.log(`  page  ${page.localeCode}/${page.path}`)
  }

  for (const asset of assets) {
    const rel = assertSafe(path.join(asset.folder || '', asset.filename), 'asset')
    const buf = Buffer.from(asset.b64 ?? '', 'base64')
    if (buf.length !== asset.fileSize) {
      throw new Error(`size mismatch for ${rel}: got ${buf.length}, expected ${asset.fileSize}`)
    }
    await writeFileMkdir(path.join(OUT, 'assets', rel), buf)
    manifest.assets.push({
      id: asset.id,
      file: `assets/${rel}`,
      url: `/${rel.split(path.sep).join('/')}`,
      mime: asset.mime,
      size: asset.fileSize
    })
    console.log(`  asset /${rel}`)
  }

  await writeFileMkdir(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n${manifest.pages.length} pages, ${manifest.assets.length} assets -> ${OUT}`)
}

main().catch(err => { console.error(err); process.exit(1) })
