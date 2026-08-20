/**
 * KaTeX inline/block rules, ported from wiki.js
 * `server/modules/rendering/markdown-katex/renderer.js`, which in turn adapts
 * https://github.com/liradb2000/markdown-it-katex.
 *
 * Rendering happens here, at build time, so the browser needs only the
 * stylesheet -- no client-side math runtime.
 */
import katex from 'katex'
import 'katex/contrib/mhchem/mhchem.js'

export function katexPlugin (md, conf = { useInline: true, useBlocks: true }) {
  const macros = {}

  if (conf.useInline) {
    md.inline.ruler.after('escape', 'katex_inline', katexInline)
    md.renderer.rules.katex_inline = (tokens, idx) => {
      try {
        return katex.renderToString(tokens[idx].content, { displayMode: false, macros })
      } catch (err) {
        console.warn(`[katex] ${err.message}`)
        return tokens[idx].content
      }
    }
  }

  if (conf.useBlocks) {
    md.block.ruler.after('blockquote', 'katex_block', katexBlock, {
      alt: ['paragraph', 'reference', 'blockquote', 'list']
    })
    md.renderer.rules.katex_block = (tokens, idx) => {
      try {
        return '<p>' + katex.renderToString(tokens[idx].content, { displayMode: true, macros }) + '</p>'
      } catch (err) {
        console.warn(`[katex] ${err.message}`)
        return tokens[idx].content
      }
    }
  }
}

// Test if a "$" at state.src[pos] is a potential opening or closing delimiter.
function isValidDelim (state, pos) {
  const max = state.posMax
  let canOpen = true
  let canClose = true

  const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1
  const nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1

  // Non-whitespace conditions, plus: a closing delimiter may not be followed by a digit.
  if (prevChar === 0x20 /* " " */ || prevChar === 0x09 /* \t */ ||
      (nextChar >= 0x30 /* "0" */ && nextChar <= 0x39 /* "9" */)) {
    canClose = false
  }
  if (nextChar === 0x20 || nextChar === 0x09) {
    canOpen = false
  }

  return { canOpen, canClose }
}

function katexInline (state, silent) {
  if (state.src[state.pos] !== '$') { return false }

  let res = isValidDelim(state, state.pos)
  if (!res.canOpen) {
    if (!silent) { state.pending += '$' }
    state.pos += 1
    return true
  }

  // Skip past properly escaped delimiters.
  const start = state.pos + 1
  let match = start
  let pos
  while ((match = state.src.indexOf('$', match)) !== -1) {
    pos = match - 1
    while (state.src[pos] === '\\') { pos -= 1 }
    if (((match - pos) % 2) === 1) { break } // even number of escapes -> real delimiter
    match += 1
  }

  // No closing delimiter: consume the $ and carry on.
  if (match === -1) {
    if (!silent) { state.pending += '$' }
    state.pos = start
    return true
  }

  // Empty content ($$) is not math.
  if (match - start === 0) {
    if (!silent) { state.pending += '$$' }
    state.pos = start + 1
    return true
  }

  res = isValidDelim(state, match)
  if (!res.canClose) {
    if (!silent) { state.pending += '$' }
    state.pos = start
    return true
  }

  if (!silent) {
    const token = state.push('katex_inline', 'math', 0)
    token.markup = '$'
    token.content = state.src.slice(start, match)
  }

  state.pos = match + 1
  return true
}

function katexBlock (state, start, end, silent) {
  let firstLine
  let lastLine
  let next
  let lastPos
  let found = false
  let pos = state.bMarks[start] + state.tShift[start]
  let max = state.eMarks[start]

  if (pos + 2 > max) { return false }
  if (state.src.slice(pos, pos + 2) !== '$$') { return false }

  pos += 2
  firstLine = state.src.slice(pos, max)

  if (silent) { return true }
  if (firstLine.trim().slice(-2) === '$$') {
    firstLine = firstLine.trim().slice(0, -2) // single-line expression
    found = true
  }

  for (next = start; !found;) {
    next++
    if (next >= end) { break }

    pos = state.bMarks[next] + state.tShift[next]
    max = state.eMarks[next]

    if (pos < max && state.tShift[next] < state.blkIndent) {
      break // non-empty line with negative indent stops the block
    }

    if (state.src.slice(pos, max).trim().slice(-2) === '$$') {
      lastPos = state.src.slice(0, max).lastIndexOf('$$')
      lastLine = state.src.slice(pos, lastPos)
      found = true
    }
  }

  state.line = next + 1

  const token = state.push('katex_block', 'math', 0)
  token.block = true
  token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '') +
    state.getLines(start + 1, next, state.tShift[start], true) +
    (lastLine && lastLine.trim() ? lastLine : '')
  token.map = [start, state.line]
  token.markup = '$$'
  return true
}
