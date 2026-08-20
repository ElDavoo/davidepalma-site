/**
 * Build the search index the Go server queries.
 *
 * Public pages only. Protected-tier search was declined, and that is also the
 * safe default: an index served to unauthenticated readers is a listing of
 * everything in it, so including private, secret or unlisted pages would leak
 * their titles and URLs even though the pages themselves stay gated.
 *
 * The index is a plain inverted index. At this scale (tens of pages) that is
 * both smaller and faster than anything with a database behind it, and it lets
 * the server answer a query from memory with no I/O.
 */

/**
 * Fold accents and case so `universita` matches `Università`. Italian readers
 * routinely type without accents, and a search that fails on that is broken.
 */
export function normalise (text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function tokenise (text) {
  return normalise(text)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2)
}

/** Strip tags and collapse whitespace, leaving readable text for snippets. */
export function htmlToText (html) {
  return html
    .replace(/<figure class="diagram[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const TITLE_BOOST = 8
const DESCRIPTION_BOOST = 4
const TAG_BOOST = 4

/**
 * @param {Array} pages  rendered pages, each { locale, path, tier, url, title, description, tags, html }
 * @returns {{docs: Array, terms: Object}}
 */
export function buildSearchIndex (pages) {
  const docs = []
  const terms = Object.create(null)

  for (const page of pages) {
    if (page.tier !== 'public') { continue }

    const text = htmlToText(page.html)
    const docId = docs.length

    docs.push({
      id: docId,
      url: page.url,
      locale: page.locale,
      title: page.title,
      description: page.description,
      tags: page.tags,
      // Kept for snippet extraction; capped so the index stays small enough to
      // sit in memory comfortably on the Pi.
      text: text.slice(0, 4000)
    })

    const weights = new Map()
    const add = (source, boost) => {
      for (const token of tokenise(source)) {
        weights.set(token, (weights.get(token) || 0) + boost)
      }
    }
    add(page.title, TITLE_BOOST)
    add(page.description, DESCRIPTION_BOOST)
    add(page.tags.join(' '), TAG_BOOST)
    add(text, 1)

    for (const [token, weight] of weights) {
      ;(terms[token] ??= []).push([docId, weight])
    }
  }

  return { docs, terms }
}
