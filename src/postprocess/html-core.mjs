/**
 * Port of wiki.js `server/modules/rendering/html-core/renderer.js`.
 *
 * This is the stage the earlier Hugo attempt could not reproduce: a cheerio pass
 * over the markdown-it output that classifies links, adds heading anchors, wraps
 * stray root nodes, and hands off to child transforms. Reproducing it is what
 * makes existing #anchors and link styling keep working.
 *
 * Differences from wiki.js, all deliberate:
 *  - internal-link validity is resolved against the build's page list instead of
 *    a database query, and no pageLinks rows are written;
 *  - the mustache/v-pre escaping is Vue-specific and only runs in parity mode.
 */
import * as cheerio from 'cheerio'
import uslug from 'uslug'
import { parsePath } from './page-path.mjs'
import { config as defaultConfig } from '../config.mjs'

const mustacheRegExp = /(\{|&#x7b;?){2}(.+?)(\}|&#x7d;?){2}/i

/**
 * @param {string} input           markdown-it output
 * @param {object} opts
 * @param {object} opts.page       { localeCode, path }
 * @param {Set<string>} opts.knownPages  "locale/path" keys, for is-valid-page
 * @param {Array<Function>} opts.children  cheerio transforms, run in order
 * @param {boolean} opts.vueCompat  emit wiki.js's Vue-only v-pre markers
 * @returns {Promise<{html: string, headings: Array, internalRefs: Array}>}
 */
export async function renderHtmlCore (input, opts = {}) {
  const {
    page = { localeCode: defaultConfig.lang.code, path: 'home' },
    knownPages = null,
    children = [],
    vueCompat = false,
    config = defaultConfig
  } = opts

  const conf = config.htmlCore
  let $ = cheerio.load(input, { decodeEntities: true })

  if ($.root().children().length < 1) {
    return { html: '', headings: [], internalRefs: [] }
  }

  // --------------------------------
  // STEP: PRE
  // --------------------------------
  for (const child of children) {
    await child($, { page, config })
  }

  // --------------------------------
  // Detect internal / external links
  // --------------------------------
  const internalRefs = []
  const reservedPrefixes = /^\/[a-z]\//i
  const exactReservedPaths = /^\/[a-z]$/i
  const isHostSet = config.host.length > 7 && config.host !== 'http://'

  $('a').each((i, elm) => {
    let href = $(elm).attr('href')

    // Ignore empty / anchor links, e-mail addresses and telephone numbers.
    if (!href || href.length < 1 || href.indexOf('#') === 0 ||
        href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) {
      return
    }

    // Strip our own host from local links.
    if (isHostSet && href.indexOf(`${config.host}/`) === 0) {
      href = href.replace(config.host, '')
    }

    if (href.indexOf('://') < 0) {
      if (reservedPrefixes.test(href) || exactReservedPaths.test(href)) {
        $(elm).addClass('is-system-link')
      } else if (href.indexOf('.') >= 0) {
        $(elm).addClass('is-asset-link')
      } else {
        let pagePath = null

        if (config.lang.namespacing) {
          if (href.indexOf('/') !== 0) {
            // Relative link: resolve against the current page, unless the page
            // is the locale home (where wiki.js treats it as locale-root).
            href = (conf.absoluteLinks || page.path === 'home')
              ? `/${page.localeCode}/${href}`
              : `/${page.localeCode}/${page.path}/${href}`
          } else if (href.charAt(3) !== '/') {
            // Root-relative but missing a locale segment -> add ours.
            href = `/${page.localeCode}${href}`
          }
        } else if (href.indexOf('/') !== 0) {
          href = (conf.absoluteLinks || page.path === 'home') ? `/${href}` : `/${page.path}/${href}`
        }

        try {
          pagePath = parsePath(new URL(`http://x${href}`).pathname)
        } catch {
          return
        }

        internalRefs.push({ localeCode: pagePath.locale, path: pagePath.path })
        $(elm).addClass('is-internal-link')
      }
    } else {
      $(elm).addClass('is-external-link')
      if (conf.openExternalLinkNewTab) {
        $(elm).attr('target', '_blank')
        $(elm).attr('rel', conf.relAttributeExternalLink)
      }
    }

    $(elm).attr('href', href)
  })

  // --------------------------------
  // Detect internal link states
  // --------------------------------
  // wiki.js queries the database here. At build time we already know every page,
  // so a set lookup answers the same question -- and a null set means "not known
  // yet", in which case we leave the link unclassified rather than guess.
  if (knownPages) {
    $('a.is-internal-link').each((i, elm) => {
      let hrefObj
      try {
        hrefObj = parsePath(new URL(`http://x${$(elm).attr('href')}`).pathname)
      } catch {
        return
      }
      $(elm).addClass(knownPages.has(`${hrefObj.locale}/${hrefObj.path}`) ? 'is-valid-page' : 'is-invalid-page')
    })
  }

  // --------------------------------
  // Add header handles
  // --------------------------------
  const headers = []
  const headings = []
  $('h1,h2,h3,h4,h5,h6').each((i, elm) => {
    let headerSlug = uslug($(elm).text())
    // An explicit {#id} wins over the generated slug.
    if ($(elm).attr('id')) { headerSlug = $(elm).attr('id') }

    // Cannot start with a number (CSS selector limitation).
    if (headerSlug.match(/^\d/)) { headerSlug = `h-${headerSlug}` }

    // Disambiguate repeats.
    if (headers.indexOf(headerSlug) >= 0) {
      let hIdx = 1
      for (;;) {
        const candidate = `${headerSlug}-${hIdx}`
        if (headers.indexOf(candidate) < 0) { headerSlug = candidate; break }
        hIdx++
      }
    }

    $(elm).attr('id', headerSlug).addClass('toc-header')
    $(elm).prepend(`<a class="toc-anchor" href="#${headerSlug}">&#xB6;</a> `)

    headers.push(headerSlug)
    headings.push({ level: Number(elm.tagName.substring(1)), slug: headerSlug, title: $(elm).text().replace(/^¶\s*/, '').trim() })
  })

  // --------------------------------
  // Wrap non-empty root text nodes
  // --------------------------------
  $('body').contents().toArray().forEach(item => {
    if (item && item.type === 'text' && item.parent.name === 'body' && item.data !== '\n' && item.data !== '\r') {
      $(item).wrap('<div></div>')
    }
  })

  // --------------------------------
  // Wrap root table nodes
  // --------------------------------
  $('body').contents().toArray().forEach(item => {
    if (item && item.name === 'table' && item.parent.name === 'body') {
      $(item).wrap('<div class="table-container"></div>')
    }
  })

  let output = decodeEscape(bodyHtml($))

  // --------------------------------
  // Escape mustache expressions (Vue only)
  // --------------------------------
  if (vueCompat) {
    $ = cheerio.load(output, { decodeEntities: true })

    const iterateMustacheNode = (node) => {
      $(node).contents().each((idx, item) => {
        if (item && item.type === 'text') {
          const rawText = $(item).text().replace(/\r?\n|\r/g, '')
          if (mustacheRegExp.test(rawText)) {
            if (!item.parent || item.parent.name === 'body') {
              $(item).wrap($('<p>').attr('v-pre', true))
            } else {
              $(item).parent().attr('v-pre', true)
            }
          }
        } else {
          iterateMustacheNode(item)
        }
      })
    }
    iterateMustacheNode($.root())
    $('pre').each((idx, elm) => { $(elm).attr('v-pre', true) })

    output = decodeEscape(bodyHtml($))
  }

  return { html: output, headings, internalRefs }
}

function bodyHtml ($) {
  return $.html('body').replace('<body>', '').replace('</body>', '')
}

/**
 * wiki.js un-escapes non-ASCII numeric entities so the stored HTML stays readable
 * (this is what turns the anchor's &#xB6; into a literal ¶).
 */
function decodeEscape (string) {
  return string.replace(/&#x([0-9a-f]{1,6});/ig, (entity, code) => {
    code = parseInt(code, 16)
    if (code < 0x80) { return entity } // keep ASCII escapes: they were escaped for a reason
    return String.fromCodePoint(code)
  })
}
