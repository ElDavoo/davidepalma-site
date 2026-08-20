/**
 * /secret/unlisted — every unlisted URL, listed.
 *
 * Unlisted URLs are unguessable by design, which means they are also
 * unfindable, including by their author. This page is the author's index of
 * them. It sits in the secret tier because it is exactly the listing that the
 * unlisted tier exists to avoid publishing.
 */
import { layout, escapeHtml } from '../../templates/layout.mjs'

export const data = {
  permalink: 'secret/unlisted.html',
  eleventyExcludeFromCollections: true
}

export function render (data) {
  const locale = data.wiki.defaultLocale
  const t = data.wiki.strings[locale]
  const unlisted = data.wiki.pages.filter(p => p.tier === 'unlisted')

  const rows = unlisted
    .sort((a, b) => a.locale.localeCompare(b.locale) || a.path.localeCompare(b.path))
    .map(p => `<tr>
      <td>${escapeHtml(p.locale)}</td>
      <td>${escapeHtml(p.path)}</td>
      <td><a href="${escapeHtml(p.url)}"><code>${escapeHtml(p.url)}</code></a></td>
    </tr>`).join('')

  const body = unlisted.length
    ? `<div class="table-container"><table>
         <thead><tr><th>Locale</th><th>Source</th><th>URL</th></tr></thead>
         <tbody>${rows}</tbody>
       </table></div>`
    : '<p>No unlisted pages.</p>'

  return layout({
    t,
    locale,
    localeNames: data.wiki.localeNames,
    title: t.unlistedIndex,
    tier: 'secret',
    noindex: true,
    trees: data.wiki.trees[locale],
    translations: {},
    devBanner: data.wiki.isDev,
    content: `<h1>${escapeHtml(t.unlistedIndex)}</h1>
      <p>${escapeHtml(t.unlistedNotice)}</p>${body}`
  })
}
