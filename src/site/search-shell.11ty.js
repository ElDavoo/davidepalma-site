/**
 * The search results page, minus the results.
 *
 * The Go server splices the result list into {{RESULTS}} and the query into
 * {{QUERY}}. Rendering the shell here rather than in Go keeps every piece of
 * page chrome in one template, so the search page cannot drift from the rest of
 * the site -- and keeps the server free of HTML templating.
 */
import { layout } from '../../templates/layout.mjs'

export const data = {
  pagination: { data: 'wiki.locales', size: 1, alias: 'locale' },
  permalink: (data) => `_shell/search-${data.locale}.html`,
  eleventyExcludeFromCollections: true
}

export function render (data) {
  const locale = data.locale
  const t = data.wiki.strings[locale]
  return layout({
    t,
    locale,
    localeNames: data.wiki.localeNames,
    title: t.searchResults,
    noindex: true,
    query: '{{QUERY}}',
    trees: data.wiki.trees[locale],
    translations: Object.fromEntries(data.wiki.locales.filter(l => l !== locale).map(l => [l, `/search?lang=${l}&q={{QUERY_ESCAPED}}`])),
    devBanner: data.wiki.isDev,
    content: '{{RESULTS}}'
  })
}
