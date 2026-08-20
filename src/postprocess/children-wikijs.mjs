/**
 * Faithful ports of wiki.js's html-core child renderers.
 *
 * These exist for `tools/parity-check.mjs`: running them proves the markdown +
 * html-core port reproduces what the live wiki serves. The site build uses the
 * replacements in children-site.mjs instead, because three of these depend on
 * client-side JavaScript (Prism, Mermaid) or on hotlinking kroki.io.
 */
import hljs from 'highlight.js'
import _ from 'lodash'
import { hoistBlockquoteClasses } from './blockquotes.mjs'

/**
 * html-blockquotes: empty upstream, because markdown-it-attrs 3 put {.is-info}
 * on the blockquote already. markdown-it-attrs 5 puts it on the paragraph, so
 * this slot now does that work. html-mediaplayers is genuinely a no-op.
 */
export const blockquotes = hoistBlockquoteClasses
export const mediaplayers = async ($) => {}

/** html-codehighlighter: tags <pre> for client-side Prism; does not actually highlight. */
export const codehighlighter = async ($) => {
  $('pre > code').each((idx, elm) => {
    const codeClasses = $(elm).attr('class') || ''
    if (codeClasses.indexOf('language-') < 0) {
      const result = hljs.highlightAuto($(elm).text())
      // Upstream calls addClass with two arguments, which cheerio ignores, so the
      // detected language never lands. Reproduced as-is for parity.
      $(elm).addClass('language-', result.language)
    }
    $(elm).parent().addClass('prismjs line-numbers')
  })
}

/** html-diagram: draw.io blocks embedded as base64 in a ```diagram fence. */
export const diagram = async ($) => {
  $('pre.diagram').each((idx, elm) => {
    $(elm).children('svg').each((sidx, svg) => { $(svg).removeAttr('content') })
    $(elm).replaceWith($(`<div class="diagram">${$(elm).html()}</div>`))
  })
}

/** html-mermaid: hands the source to the browser's Mermaid runtime. */
export const mermaid = async ($) => {
  $('pre.prismjs > code.language-mermaid').each((i, elm) => {
    $(elm).parent().replaceWith(`<div class="mermaid">${$(elm).html()}</div>`)
  })
}

/** html-tabset: builds a Vue <tabset> custom element with v-slot templates. */
export const tabset = async ($) => {
  for (let i = 1; i < 6; i++) {
    $(`h${i}.tabset`).each((idx, elm) => {
      let content = '<tabset>'
      const tabs = []
      const tabContents = []
      $(elm).nextUntil(_.times(i, t => `h${t + 1}`).join(', '), `h${i + 1}`).each((hidx, hd) => {
        tabs.push(`<li>${$(hd).html()}</li>`)
        let tabContent = ''
        $(hd).nextUntil(_.times(i + 1, t => `h${t + 1}`).join(', ')).each((cidx, celm) => {
          tabContent += $.html(celm)
          $(celm).remove()
        })
        tabContents.push(`<div class="tabset-panel">${tabContent}</div>`)
        $(hd).remove()
      })
      content += `<template v-slot:tabs>${tabs.join('')}</template>`
      content += `<template v-slot:content>${tabContents.join('')}</template>`
      content += '</tabset>'
      $(elm).replaceWith($(content))
    })
  }
}

/** The enabled set on davidepalma.it, in the order html-core applies them. */
export const wikijsChildren = [blockquotes, codehighlighter, diagram, mediaplayers, mermaid, tabset]
