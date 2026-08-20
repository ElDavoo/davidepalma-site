/**
 * markdown-it instance mirroring wiki.js's `markdown-core` renderer and the
 * child plugins enabled on davidepalma.it.
 *
 * Enabled there (and here): markdownAbbr, markdownEmoji, markdownExpandtabs,
 * markdownFootnotes, markdownImsize, markdownKatex, markdownKroki,
 * markdownPlantuml, markdownSupsub, markdownTasklists.
 *
 * Disabled there (and here): markdownMultiTable, markdownPivotTable,
 * markdownMathjax. Adding any of them would render pages the live wiki does not.
 */
import MarkdownIt from 'markdown-it'
import mdAttrs from 'markdown-it-attrs'
import mdDecorate from 'markdown-it-decorate'
import mdAbbr from 'markdown-it-abbr'
import { full as mdEmoji } from 'markdown-it-emoji'
import mdExpandTabs from 'markdown-it-expand-tabs'
import mdFootnote from 'markdown-it-footnote'
import mdImsize from 'markdown-it-imsize'
import mdSub from 'markdown-it-sub'
import mdSup from 'markdown-it-sup'
import mdTaskLists from 'markdown-it-task-lists'
import twemoji from 'twemoji'
import escapeHtml from 'lodash/escape.js'

import { katexPlugin } from './katex.mjs'
import { krokiPlugin } from './kroki.mjs'
import { plantumlPlugin } from './plantuml.mjs'
import { config as defaultConfig } from '../config.mjs'

const quoteStyles = {
  Chinese: '””‘’',
  English: '“”‘’',
  French: ['«\xA0', '\xA0»', '‹\xA0', '\xA0›'],
  German: '„“‚‘',
  Greek: '«»‘’',
  Japanese: '「」「」',
  Hungarian: '„”’’',
  Polish: '„”‚‘',
  Portuguese: '«»‘’',
  Russian: '«»„“',
  Spanish: '«»‘’',
  Swedish: '””’’'
}

export function createMarkdownIt (config = defaultConfig) {
  const core = config.markdownCore

  const md = new MarkdownIt({
    html: core.allowHTML,
    breaks: core.linebreaks,
    linkify: core.linkify,
    typographer: core.typographer,
    quotes: quoteStyles[core.quotes] ?? quoteStyles.English,
    // wiki.js does not highlight here: it emits escaped source and lets
    // client-side Prism colour it. We keep that shape so the postprocess stage
    // sees exactly what wiki.js's does, then highlight at build time instead.
    highlight (str, lang) {
      if (lang === 'diagram') {
        return '<pre class="diagram">' + Buffer.from(str, 'base64').toString() + '</pre>'
      }
      return `<pre><code class="language-${lang}">${escapeHtml(str)}</code></pre>`
    }
  })

  // markdownCore itself, in wiki.js order: attrs then decorate.
  md.use(mdAttrs, { allowedAttributes: ['id', 'class', 'target'] })
  md.use(mdDecorate)

  // Child renderers.
  md.use(mdAbbr)

  md.use(mdEmoji)
  md.renderer.rules.emoji = (token, idx) => twemoji.parse(token[idx].content, {
    callback (icon) { return `/_assets/svg/twemoji/${icon}.svg` }
  })

  md.use(mdExpandTabs, { tabWidth: Number(config.markdownExpandtabs?.tabWidth) || 4 })
  md.use(mdFootnote)
  md.use(mdImsize)
  katexPlugin(md, config.markdownKatex)
  krokiPlugin(md, config.markdownKroki)
  plantumlPlugin(md, config.markdownPlantuml)
  if (config.markdownSupsub?.subEnabled) { md.use(mdSub) }
  if (config.markdownSupsub?.supEnabled) { md.use(mdSup) }
  md.use(mdTaskLists, { label: false, labelAfter: false })

  return md
}

export function renderMarkdown (input, config = defaultConfig) {
  return createMarkdownIt(config).render(input)
}
