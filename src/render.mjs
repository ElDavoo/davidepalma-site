/**
 * Render the loaded pages: markdown -> html-core -> the no-JavaScript transforms.
 */
import { createMarkdownIt } from './markdown/pipeline.mjs'
import { renderHtmlCore } from './postprocess/html-core.mjs'
import { siteChildren } from './postprocess/children-site.mjs'
import { knownPageKeys } from './content.mjs'
import { config } from './config.mjs'

export async function renderPages (pages, opts = {}) {
  const md = createMarkdownIt(config)
  const knownPages = knownPageKeys(pages)
  const children = siteChildren({ diagrams: opts.diagrams })
  const warnings = []

  const rendered = []
  for (const page of pages) {
    const { html, headings, internalRefs } = await renderHtmlCore(md.render(page.body), {
      page: { localeCode: page.locale, path: page.path },
      knownPages,
      children,
      vueCompat: false,
      config
    })
    rendered.push({ ...page, html, headings, internalRefs })
  }

  return { pages: rendered, warnings }
}
