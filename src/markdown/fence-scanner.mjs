/**
 * The block-fence scanner shared by wiki.js's markdown-kroki and markdown-plantuml
 * renderers. Both copy the same ~90 lines; this factors it out unchanged in behaviour.
 *
 * Returns null when `startLine` does not open the marker, otherwise the fence's
 * contents plus the parser bookkeeping the caller needs to push a token.
 */
export function scanFence (state, startLine, endLine, openMarker, closeMarker) {
  const openChar = openMarker.charCodeAt(0)
  const closeChar = closeMarker.charCodeAt(0)

  let start = state.bMarks[startLine] + state.tShift[startLine]
  let max = state.eMarks[startLine]
  let i

  // Cheap first-character test rejects most lines immediately.
  if (openChar !== state.src.charCodeAt(start)) { return null }
  for (i = 0; i < openMarker.length; ++i) {
    if (openMarker[i] !== state.src[start + i]) { return null }
  }

  const markup = state.src.slice(start, start + i)
  const params = state.src.slice(start + i, max)

  let nextLine = startLine
  let autoClosed = false

  for (;;) {
    nextLine++
    // An unclosed block is auto-closed by the end of the document or parent.
    if (nextLine >= endLine) { break }

    start = state.bMarks[nextLine] + state.tShift[nextLine]
    max = state.eMarks[nextLine]

    if (start < max && state.sCount[nextLine] < state.blkIndent) {
      break // non-empty line with negative indent stops the list
    }
    if (closeChar !== state.src.charCodeAt(start)) { continue }
    if (state.sCount[nextLine] > state.sCount[startLine]) {
      continue // closing fence must not be indented past the opening fence
    }

    let closeMarkerMatched = true
    for (i = 0; i < closeMarker.length; ++i) {
      if (closeMarker[i] !== state.src[start + i]) { closeMarkerMatched = false; break }
    }
    if (!closeMarkerMatched) { continue }
    if (state.skipSpaces(start + i) < max) { continue } // tail must be spaces only

    autoClosed = true
    break
  }

  const contents = state.src.split('\n').slice(startLine + 1, nextLine).join('\n')

  return { markup, params, contents, nextLine, autoClosed }
}

/**
 * wiki.js builds the image alt from the fence's info string by running it back
 * through the inline parser, mimicking what the image rule does.
 */
export function altTokens (state, params) {
  const altToken = []
  const alt = params ? params.slice(1) : 'uml diagram'
  state.md.inline.parse(alt, state.md, state.env, altToken)
  return altToken
}
