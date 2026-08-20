/** /{locale}/t — every tag in use, with counts. */
import { layout, escapeHtml } from '../../templates/layout.mjs'

export const data = {
  pagination: { data: 'wiki.locales', size: 1, alias: 'locale' },
  permalink: (data) => `${data.locale}/t.html`,
  eleventyExcludeFromCollections: true
}

export function render (data) {
  const locale = data.locale
  const t = data.wiki.strings[locale]
  const byTag = data.wiki.tags[locale] ?? {}
  const names = Object.keys(byTag).sort((a, b) => a.localeCompare(b, locale))

  const list = names.map(tag =>
    `<li><a href="/${escapeHtml(locale)}/t/${encodeURIComponent(tag)}">${escapeHtml(tag)}</a> ` +
    `<span class="search-result-url">(${byTag[tag].length})</span></li>`
  ).join('')

  return layout({
    t,
    locale,
    localeNames: data.wiki.localeNames,
    title: t.allTags,
    trees: data.wiki.trees[locale],
    translations: Object.fromEntries(data.wiki.locales.filter(l => l !== locale).map(l => [l, `/${l}/t`])),
    devBanner: data.wiki.isDev,
    content: `<h1>${escapeHtml(t.allTags)}</h1>${names.length ? `<ul class="page-tags">${list}</ul>` : `<p>${escapeHtml(t.searchNoResults)}</p>`}`
  })
}
