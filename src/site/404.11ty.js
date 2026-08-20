/** Per-locale 404 body, served by the Go server. */
import { layout, escapeHtml } from '../../templates/layout.mjs'
import { treesFor } from '../tree.mjs'

export const data = {
  pagination: { data: 'wiki.locales', size: 1, alias: 'locale' },
  permalink: (data) => `${data.locale}/404.html`,
  eleventyExcludeFromCollections: true
}

export function render (data) {
  const locale = data.locale
  const t = data.wiki.strings[locale]
  return layout({
    t,
    locale,
    localeNames: data.wiki.localeNames,
    title: t.notFoundTitle,
    noindex: true,
    trees: treesFor('public', data.wiki.trees[locale]),
    translations: {},
    devBanner: data.wiki.isDev,
    content: `<h1>${escapeHtml(t.notFoundTitle)}</h1><p>${escapeHtml(t.notFoundBody)}</p>
      <p><a href="/${escapeHtml(locale)}/home">${escapeHtml(t.backHome)}</a></p>`
  })
}
