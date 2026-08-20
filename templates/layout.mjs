/**
 * The page shell.
 *
 * Plain template functions rather than a template language: everything the build
 * emits is assembled here, so "does this page contain a <script>?" is answerable
 * by reading one file. (CI asserts it too -- see tools/check-no-js.mjs.)
 */
import { renderTree } from '../src/tree.mjs'
import { LOCALES } from '../src/config.mjs'

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const attr = (s) => escapeHtml(s)

/**
 * Language selector: link to the same article in the other locale where a
 * translation exists, and to that locale's home where it does not -- dropping
 * the reader on a home page is better than a 404, but only as a fallback.
 */
function languageSelector (ctx) {
  const { t, locale, translations = {} } = ctx
  const links = LOCALES.map(other => {
    const name = ctx.localeNames[other] ?? other
    if (other === locale) {
      return `<li><span class="lang-current" aria-current="true" lang="${attr(other)}">${escapeHtml(name)}</span></li>`
    }
    const href = translations[other] || `/${other}/home`
    const untranslated = translations[other] ? '' : ' class="lang-fallback"'
    return `<li><a href="${attr(href)}" lang="${attr(other)}" hreflang="${attr(other)}"${untranslated}>${escapeHtml(name)}</a></li>`
  })
  return `<nav class="lang" aria-label="${attr(t.language)}"><ul>${links.join('')}</ul></nav>`
}

function searchForm (ctx, value = '') {
  const { t, locale } = ctx
  return `<form class="search" method="get" action="/search" role="search">
    <input type="hidden" name="lang" value="${attr(locale)}">
    <label class="visually-hidden" for="q">${escapeHtml(t.search)}</label>
    <input type="search" id="q" name="q" value="${attr(value)}" placeholder="${attr(t.searchPlaceholder)}" autocomplete="off">
    <button type="submit">${escapeHtml(t.search)}</button>
  </form>`
}

function tocList (headings, t) {
  // h1 is the page title in practice; a TOC of one entry is noise.
  const items = headings.filter(h => h.level >= 2 && h.level <= 4)
  if (items.length < 2) { return '' }

  const min = Math.min(...items.map(h => h.level))
  return `<nav class="toc" aria-labelledby="toc-heading">
    <h2 class="toc-title" id="toc-heading">${escapeHtml(t.onThisPage)}</h2>
    <ul>${items.map(h =>
      `<li class="toc-level-${h.level - min}"><a href="#${attr(h.slug)}">${escapeHtml(h.title)}</a></li>`
    ).join('')}</ul>
  </nav>`
}

function tierBadge (ctx) {
  const { t, tier } = ctx
  if (!tier || tier === 'public') { return '' }
  const label = { private: t.tierPrivate, secret: t.tierSecret, unlisted: t.tierUnlisted }[tier]
  return `<p class="tier-badge tier-${attr(tier)}">${escapeHtml(label)}</p>`
}

/**
 * @param {object} ctx
 * @param {string} ctx.title        document title
 * @param {string} ctx.content      main HTML
 * @param {object} ctx.t            i18n strings for ctx.locale
 * @param {string} ctx.locale
 * @param {object} ctx.trees        { tier: treeNodes } for the sidebar
 * @param {string} ctx.tier         tier of the current page
 * @param {Array}  ctx.headings     for the TOC
 * @param {boolean} ctx.devBanner
 */
export function layout (ctx) {
  const { t, locale, title, content, headings = [], trees = {}, noindex = false } = ctx
  const fullTitle = title && title !== t.siteTitle ? `${title} — ${t.siteTitle}` : t.siteTitle

  const treeSections = Object.entries(trees).map(([tier, nodes]) => {
    const heading = tier === 'public'
      ? t.browse
      : { private: t.tierPrivate, secret: t.tierSecret }[tier] ?? tier
    return `<section class="tree-section tree-section-${attr(tier)}">
      <h2 class="tree-title">${escapeHtml(heading)}</h2>
      ${renderTree(nodes, ctx.currentPath ?? null)}
    </section>`
  }).join('')

  return `<!doctype html>
<html lang="${attr(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
${ctx.description ? `<meta name="description" content="${attr(ctx.description)}">\n` : ''}${noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="/_assets/site.css">
<link rel="stylesheet" href="/_assets/katex.css">
<link rel="icon" href="/icona_palma.png">
</head>
<body>
<a class="skip-link" href="#main">${escapeHtml(t.skipToContent)}</a>
${ctx.devBanner ? `<p class="dev-banner">${escapeHtml(t.devBanner)}</p>\n` : ''}<header class="site-header">
  <a class="site-title" href="/${attr(locale)}/home">${escapeHtml(t.siteTitle)}</a>
  ${searchForm(ctx, ctx.query ?? '')}
  ${languageSelector(ctx)}
</header>

<div class="layout">
  <nav class="sidebar" aria-label="${attr(t.nav)}">
    ${treeSections}
    <p class="sidebar-links"><a href="/${attr(locale)}/t">${escapeHtml(t.allTags)}</a></p>
  </nav>

  <main id="main" class="content">
    ${tierBadge(ctx)}
    ${tocList(headings, t)}
    <article class="article">
${content}
    </article>
    ${ctx.footer ?? ''}
  </main>
</div>
</body>
</html>
`
}
