/** One HTML file per page, at the URL its tier dictates. */
import { layout, escapeHtml } from '../../templates/layout.mjs'

export const data = {
  pagination: { data: 'wiki.pages', size: 1, alias: 'doc' },
  // `page` is reserved by Eleventy, hence `doc`.
  permalink: (data) => `${data.doc.url.slice(1)}.html`,
  eleventyExcludeFromCollections: true
}

function pageFooter (doc) {
  const t = doc.t
  const bits = []

  if (doc.date) {
    const iso = String(doc.date)
    bits.push(`<p>${escapeHtml(t.lastEdited)}: <time datetime="${escapeHtml(iso)}">${escapeHtml(iso.slice(0, 10))}</time></p>`)
  }

  // Tag links only make sense for public pages: /{locale}/t/{tag} lists public
  // pages, so a protected page's tags would lead somewhere it does not appear.
  if (doc.tier === 'public' && doc.tags.length) {
    bits.push(`<ul class="page-tags">${doc.tags.map(tag =>
      `<li><a href="/${escapeHtml(doc.locale)}/t/${encodeURIComponent(tag)}">${escapeHtml(tag)}</a></li>`
    ).join('')}</ul>`)
  }

  return bits.length ? `<footer class="page-meta">${bits.join('')}</footer>` : ''
}

export function render (data) {
  const doc = data.doc
  const notice = doc.tier === 'unlisted'
    ? `<p class="unlisted-notice">${escapeHtml(doc.t.unlistedNotice)}</p>`
    : ''

  return layout({
    t: doc.t,
    locale: doc.locale,
    localeNames: data.wiki.localeNames,
    title: doc.title,
    description: doc.description,
    tier: doc.tier,
    noindex: doc.tier !== 'public',
    currentPath: doc.path,
    headings: doc.headings,
    trees: doc.trees,
    translations: doc.translations,
    devBanner: data.wiki.isDev,
    content: notice + doc.html,
    footer: pageFooter(doc)
  })
}
