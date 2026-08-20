/** robots.txt — keep crawlers out of the gated prefixes and the unlisted space. */
import { config } from '../config.mjs'

export const data = { permalink: 'robots.txt', eleventyExcludeFromCollections: true }

export function render (data) {
  const disallow = data.wiki.locales.flatMap(l => [`/${l}/private/`, `/${l}/secret/`, `/${l}/u/`])
  return `User-agent: *
${['/private/', '/secret/', ...disallow].map(p => `Disallow: ${p}`).join('\n')}
Disallow: /search

Sitemap: ${config.host}/sitemap.xml
`
}
