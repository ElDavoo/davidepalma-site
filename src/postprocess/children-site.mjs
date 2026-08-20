/**
 * The no-JavaScript replacements for wiki.js's html-core children.
 *
 * Three of the upstream transforms hand work to the browser:
 *   html-codehighlighter tags <pre> for client-side Prism,
 *   html-mermaid emits a <div class="mermaid"> for the Mermaid runtime,
 *   html-tabset emits a Vue <tabset> custom element.
 * Each is replaced here by something that is finished by the time the HTML is
 * written, so the reading experience needs no script at all.
 */
import hljs from 'highlight.js'
import _ from 'lodash'
import { inlineDiagrams } from './diagrams.mjs'

/** {.is-info} and friends already come from markdown-it-attrs; nothing to do. */
export const blockquotes = async ($) => {}
export const mediaplayers = async ($) => {}

/** html-diagram: draw.io blocks arrive already-inlined as base64 SVG. */
export const diagram = async ($) => {
  $('pre.diagram').each((idx, elm) => {
    $(elm).children('svg').each((sidx, svg) => { $(svg).removeAttr('content') })
    $(elm).replaceWith($(`<div class="diagram">${$(elm).html()}</div>`))
  })
}

/**
 * Highlight at build time instead of shipping Prism.
 *
 * Runs after the diagram pass, so fences that became SVG are already gone and
 * we never highlight a diagram's source by mistake.
 */
export const codehighlighter = async ($) => {
  $('pre > code').each((idx, elm) => {
    const $code = $(elm)
    const classes = $code.attr('class') || ''
    const declared = /language-([A-Za-z0-9_+#-]+)/.exec(classes)?.[1]
    const source = $code.text()

    let result
    if (declared && hljs.getLanguage(declared)) {
      result = hljs.highlight(source, { language: declared, ignoreIllegals: true })
    } else if (source.trim()) {
      // No usable language: let highlight.js guess, as wiki.js intended to.
      result = hljs.highlightAuto(source)
    }

    if (result?.value) {
      $code.html(result.value)
      $code.addClass('hljs')
      if (!declared && result.language) { $code.addClass(`language-${result.language}`) }
    }
    $code.parent().addClass('code-block')
  })
}

/**
 * html-tabset, without Vue.
 *
 * A radio group drives the panels: exactly one input is checked, and the general
 * sibling combinator reveals the matching panel. Radios in a group are natively
 * arrow-key navigable, so this keeps keyboard access without script.
 *
 * The <label> elements are not an ARIA tablist -- a faithful tablist needs
 * roving tabindex, which needs JavaScript. Screen readers announce these as a
 * labelled radio group, which is a fair description of what they do.
 */
export function cssTabsets () {
  let counter = 0

  return async function cssTabsetsTransform ($) {
    for (let i = 1; i < 6; i++) {
      $(`h${i}.tabset`).each((idx, elm) => {
        const group = `tabset-${++counter}`
        const label = $(elm).text().replace(/^¶\s*/, '').trim()

        const tabs = []
        const panels = []

        $(elm).nextUntil(_.times(i, t => `h${t + 1}`).join(', '), `h${i + 1}`).each((hidx, hd) => {
          const id = `${group}-${hidx}`
          const checked = hidx === 0 ? ' checked' : ''
          tabs.push(
            `<input type="radio" name="${group}" id="${id}" class="tabset-radio"${checked}>` +
            `<label for="${id}" class="tabset-label">${$(hd).html()}</label>`
          )

          let panelContent = ''
          $(hd).nextUntil(_.times(i + 1, t => `h${t + 1}`).join(', ')).each((cidx, celm) => {
            panelContent += $.html(celm)
            $(celm).remove()
          })
          panels.push(`<div class="tabset-panel">${panelContent}</div>`)
          $(hd).remove()
        })

        if (tabs.length === 0) { return } // a .tabset heading with no tabs under it

        const aria = label ? ` aria-label="${label.replace(/"/g, '&quot;')}"` : ''
        $(elm).replaceWith($(
          `<div class="tabset" role="group"${aria}>` +
            tabs.join('') +
            `<div class="tabset-panels">${panels.join('')}</div>` +
          '</div>'
        ))
      })
    }
  }
}

/**
 * Build the transform chain for a site build.
 *
 * Order matters: diagrams must resolve before highlighting (so mermaid source is
 * never syntax-coloured as code), and tabsets last (so panels contain finished
 * markup rather than placeholders).
 */
export function siteChildren (opts = {}) {
  return [
    blockquotes,
    diagram,
    inlineDiagrams(opts.diagrams),
    codehighlighter,
    mediaplayers,
    cssTabsets()
  ]
}
