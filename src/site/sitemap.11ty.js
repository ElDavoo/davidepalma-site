/** sitemap.xml — public pages only; every other tier is deliberately absent. */
import { config } from '../config.mjs'

export const data = { permalink: 'sitemap.xml', eleventyExcludeFromCollections: true }

export function render (data) {
  const urls = data.wiki.pages
    .filter(p => p.tier === 'public')
    .map(p => `  <url><loc>${config.host}${p.url}</loc>${p.date ? `<lastmod>${String(p.date).slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}
