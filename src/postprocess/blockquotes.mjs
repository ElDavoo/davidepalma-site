/**
 * Restore wiki.js's blockquote styling classes.
 *
 * `> lol {.is-success}` must produce
 *
 *     <blockquote class="is-success"><p>lol</p></blockquote>
 *
 * markdown-it-attrs 3 (the version wiki.js pins) attached a trailing attribute
 * block to the enclosing block element, so the class landed on the blockquote.
 * markdown-it-attrs 5 attaches it to the paragraph instead:
 *
 *     <blockquote><p class="is-success">lol</p></blockquote>
 *
 * There is no option to restore the old placement, and the class must be on the
 * blockquote for the border colour to apply. So we hoist it here.
 *
 * Scoped to wiki.js's `is-*` convention deliberately: those are the classes the
 * blockquote styling is built around, and confining the rule to them means a
 * paragraph class written for any other purpose is left where the author put it.
 *
 * Upstream, html-blockquotes is an empty module -- it had nothing to do because
 * markdown-it-attrs already placed the class correctly. This fills that slot.
 */
const WIKIJS_BLOCKQUOTE_CLASS = /^is-[a-z0-9-]+$/

export async function hoistBlockquoteClasses ($) {
  $('blockquote').each((i, quote) => {
    const $quote = $(quote)

    $quote.children('p').each((j, para) => {
      const $para = $(para)
      const classes = ($para.attr('class') || '').split(/\s+/).filter(Boolean)
      const hoist = classes.filter(c => WIKIJS_BLOCKQUOTE_CLASS.test(c))
      if (hoist.length === 0) { return }

      const keep = classes.filter(c => !hoist.includes(c))
      if (keep.length) { $para.attr('class', keep.join(' ')) } else { $para.removeAttr('class') }

      for (const c of hoist) { $quote.addClass(c) }
    })
  })
}
