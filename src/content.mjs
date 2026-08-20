/**
 * Load markdown from the content repositories and turn it into the page model
 * the rest of the build works from.
 *
 * Two sources, because the private tiers must not sit in a public git history:
 *   ElDavoo/wikijs-content        public   -> public + unlisted
 *   ElDavoo/wiki-content-private  private  -> private + secret
 *
 * A page's tier defaults to its repository's default and can be overridden per
 * page with `access:` in the frontmatter -- but only downward in visibility: a
 * file in the public repo can never claim a protected tier, because the file
 * itself is already public. Getting that backwards would be a quiet way to
 * believe something is protected when its source is on GitHub.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { unlistedSegment } from './unlisted.mjs'
import { LOCALES, DEFAULT_LOCALE } from './config.mjs'

export const TIERS = ['public', 'unlisted', 'private', 'secret']

/** Which tiers a source repo is allowed to declare. */
const ALLOWED_TIERS = {
  public: ['public', 'unlisted'],
  private: ['private', 'secret']
}

/** Files a repository keeps at its root that are not pages. */
const REPO_FURNITURE = new Set([
  'readme.md', 'license.md', 'licence.md', 'contributing.md',
  'changelog.md', 'security.md', 'code_of_conduct.md'
])

const entry_basename = (rel) => rel.split(path.sep).pop().toLowerCase()

/** URL prefix inserted after the locale for each tier. */
const TIER_PREFIX = { public: '', unlisted: 'u', private: 'private', secret: 'secret' }

async function walk (dir, base = dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') { return [] }
    throw err
  }
  const out = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) { continue }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...await walk(full, base))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.relative(base, full))
    }
  }
  return out
}

/** wiki.js writes `tags: a, b` as a comma-joined string; YAML lists also occur. */
function parseTags (value) {
  if (Array.isArray(value)) { return value.map(t => String(t).trim()).filter(Boolean) }
  if (typeof value === 'string') { return value.split(',').map(t => t.trim()).filter(Boolean) }
  return []
}

/**
 * @param {Array<{dir: string, defaultTier: 'public'|'private', name: string}>} sources
 * @param {{unlistedSalt: string}} opts
 */
export async function loadPages (sources, opts = {}) {
  const pages = []
  const problems = []

  for (const source of sources) {
    const files = await walk(source.dir)

    for (const rel of files.sort()) {
      const parts = rel.split(path.sep)
      const locale = parts[0]

      if (!LOCALES.includes(locale)) {
        // Repo furniture at the root is expected; anything else up there is
        // probably a page filed in the wrong place and worth saying so.
        if (parts.length > 1 || !REPO_FURNITURE.has(entry_basename(rel))) {
          problems.push(`${source.name}: ${rel} is not under a known locale directory (${LOCALES.join(', ')})`)
        }
        continue
      }

      const pagePath = parts.slice(1).join('/').replace(/\.md$/, '')
      const raw = await fs.readFile(path.join(source.dir, rel), 'utf8')
      const { data, content } = matter(raw)

      if (data.published === false) { continue }

      const allowed = ALLOWED_TIERS[source.defaultTier]
      let tier = data.access ?? source.defaultTier
      if (!allowed.includes(tier)) {
        problems.push(
          `${source.name}: ${rel} declares access: ${tier}, which the ${source.defaultTier} repository cannot grant ` +
          `(allowed: ${allowed.join(', ')}). Falling back to ${source.defaultTier}.`
        )
        tier = source.defaultTier
      }

      let url
      if (tier === 'unlisted') {
        const segment = data.slug || unlistedSegment(locale, pagePath, opts.unlistedSalt)
        url = `/${locale}/${TIER_PREFIX.unlisted}/${segment}`
      } else if (TIER_PREFIX[tier]) {
        url = `/${locale}/${TIER_PREFIX[tier]}/${pagePath}`
      } else {
        url = `/${locale}/${pagePath}`
      }

      pages.push({
        locale,
        path: pagePath,
        tier,
        url,
        source: source.name,
        file: path.join(source.dir, rel),
        title: data.title || pagePath.split('/').pop(),
        description: data.description || '',
        tags: parseTags(data.tags),
        date: data.date || null,
        dateCreated: data.dateCreated || null,
        editor: data.editor || 'markdown',
        body: content
      })
    }
  }

  // A duplicate URL means one page silently overwrites another. Catch it here.
  const byUrl = new Map()
  for (const page of pages) {
    if (byUrl.has(page.url)) {
      problems.push(`duplicate URL ${page.url}: ${byUrl.get(page.url).file} and ${page.file}`)
    }
    byUrl.set(page.url, page)
  }

  return { pages, problems }
}

/** "locale/path" keys for html-core's is-valid-page / is-invalid-page classes. */
export function knownPageKeys (pages) {
  return new Set(pages.map(p => `${p.locale}/${p.path}`))
}

/**
 * Pair each page with its translation in the other locales, so the language
 * selector can link to the same article rather than dumping the reader on a home
 * page. Pages match by identical path across locales.
 */
export function translationsOf (page, pages) {
  const out = {}
  for (const locale of LOCALES) {
    if (locale === page.locale) { continue }
    const match = pages.find(p => p.locale === locale && p.path === page.path && p.tier === page.tier)
    out[locale] = match ? match.url : null
  }
  return out
}

export { DEFAULT_LOCALE, LOCALES }
