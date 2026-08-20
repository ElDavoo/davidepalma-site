/** /{locale}/t/{tag} — public pages carrying one tag. */
import { layout, escapeHtml } from '../../templates/layout.mjs'
import { treesFor } from '../tree.mjs'

export const data = {
  pagination: { data: 'wiki.tagPages', size: 1, alias: 'entry' },
  permalink: (data) => `${data.entry.locale}/t/${data.entry.tag}.html`,
  eleventyExcludeFromCollections: true
}

export function render (data) {
  const { locale, tag, pages } = data.entry
  const t = data.wiki.strings[locale]

  const list = pages
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, locale))
    .map(p => `<li><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a>${
      p.description ? ` — <span class="search-result-url">${escapeHtml(p.description)}</span>` : ''
    }</li>`)
    .join('')

  return layout({
    t,
    locale,
    localeNames: data.wiki.localeNames,
    title: `${t.taggedWith} “${tag}”`,
    trees: treesFor('public', data.wiki.trees[locale]),
    translations: {},
    devBanner: data.wiki.isDev,
    content: `<h1>${escapeHtml(t.taggedWith)} “${escapeHtml(tag)}”</h1><ul>${list}</ul>
      <p><a href="/${escapeHtml(locale)}/t">${escapeHtml(t.allTags)}</a></p>`
  })
}
