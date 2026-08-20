/**
 * The whole site model, assembled once per build.
 *
 * Eleventy re-runs this on every watch rebuild. At this scale (tens of pages)
 * rendering everything takes well under a second, and diagram results are cached
 * on disk, so there is no reason to complicate it with incremental state.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import { loadPages, translationsOf } from '../../content.mjs'
import { renderPages } from '../../render.mjs'
import { treesByTier } from '../../tree.mjs'
import { buildSearchIndex } from '../../search-index.mjs'
import { contentSources } from '../../sources.mjs'
import { LOCALES, DEFAULT_LOCALE } from '../../config.mjs'

const ROOT = path.resolve(import.meta.dirname, '../../..')

async function loadStrings () {
  const strings = {}
  for (const locale of LOCALES) {
    strings[locale] = JSON.parse(await fs.readFile(path.join(ROOT, 'src/i18n', `${locale}.json`), 'utf8'))
  }
  return strings
}

export default async function () {
  const isDev = process.env.ELEVENTY_RUN_MODE === 'serve' || process.env.ELEVENTY_RUN_MODE === 'watch'
  const sources = contentSources(ROOT)
  const strings = await loadStrings()

  const { pages: loaded, problems } = await loadPages(sources, {
    // Dev builds need *a* salt to produce URLs at all; using the production one
    // locally would put real unlisted URLs in a developer's history for no
    // benefit, so dev gets its own placeholder.
    unlistedSalt: process.env.UNLISTED_SALT || (isDev ? 'dev-only-unlisted-salt' : '')
  })

  for (const problem of problems) { console.warn(`[content] ${problem}`) }

  // Fail the build on an unrenderable diagram, except in dev -- shipping a
  // broken diagram is worse than a red build, but it should not block authoring.
  // DIAGRAMS_STRICT=0 forces leniency (useful when a Kroki backend is down);
  // DIAGRAMS_STRICT=1 forces strictness.
  const strictDiagrams = process.env.DIAGRAMS_STRICT
    ? process.env.DIAGRAMS_STRICT !== '0'
    : !isDev

  const { pages } = await renderPages(loaded, {
    diagrams: { strict: strictDiagrams, server: process.env.KROKI_SERVER }
  })

  // Sidebar trees, per locale and tier.
  const trees = {}
  for (const locale of LOCALES) { trees[locale] = treesByTier(pages, locale) }

  // Tags, public pages only -- a tag page is a listing, so an unlisted or
  // protected page appearing in one would defeat the point of its tier.
  const tags = {}
  for (const page of pages) {
    if (page.tier !== 'public') { continue }
    for (const tag of page.tags) {
      ;(tags[page.locale] ??= {})
      ;(tags[page.locale][tag] ??= []).push(page)
    }
  }

  const withMeta = pages.map(page => ({
    ...page,
    translations: translationsOf(page, pages),
    t: strings[page.locale],
    trees: trees[page.locale]
  }))

  return {
    isDev,
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    localeNames: Object.fromEntries(LOCALES.map(l => [l, strings[l].localeName])),
    strings,
    pages: withMeta,
    trees,
    tags,
    // Flat list for pagination: Eleventy paginates an object by its keys, so a
    // nested {locale: {tag: [...]}} would hand templates a bare string.
    tagPages: Object.entries(tags).flatMap(([locale, byTag]) =>
      Object.entries(byTag).map(([tag, taggedPages]) => ({ locale, tag, pages: taggedPages }))
    ),
    tagList: Object.fromEntries(
      Object.entries(tags).map(([locale, byTag]) => [locale, Object.keys(byTag).sort((a, b) => a.localeCompare(b, locale))])
    ),
    searchIndex: buildSearchIndex(pages),
    manifest: {
      defaultLocale: DEFAULT_LOCALE,
      locales: LOCALES,
      pages: pages.map(p => ({
        url: p.url, file: `${p.url.slice(1)}.html`, tier: p.tier,
        locale: p.locale, path: p.path, title: p.title
      }))
    }
  }
}
