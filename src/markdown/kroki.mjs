/**
 * Kroki fence, ported from wiki.js
 * `server/modules/rendering/markdown-kroki/renderer.js`.
 *
 * wiki.js emits an <img> pointing at kroki.io, so every page view hits a third
 * party. We keep the identical token/URL shape here -- parity mode reproduces it
 * byte for byte -- and the site build later swaps the <img> for an inlined SVG
 * (see src/postprocess/diagrams.mjs).
 */
import zlib from 'node:zlib'
import { scanFence, altTokens } from './fence-scanner.mjs'

export function krokiPlugin (md, conf = {}) {
  const openMarker = conf.openMarker || '```kroki'
  const closeMarker = conf.closeMarker || '```'
  const server = conf.server || 'https://kroki.io'

  md.block.ruler.before('fence', 'kroki', (state, startLine, endLine, silent) => {
    const fence = scanFence(state, startLine, endLine, openMarker, closeMarker)
    if (!fence) { return false }
    if (silent) { return true }

    const children = altTokens(state, fence.params)

    // First line of the body names the diagram type; the rest is the source.
    let contents = fence.contents
    let firstlf = contents.indexOf('\n')
    if (firstlf === -1) { firstlf = undefined }
    const diagramType = contents.substring(0, firstlf)
    contents = contents.substring(firstlf + 1)

    const encoded = zlib.deflateSync(contents).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_')

    const token = state.push('kroki', 'img', 0)
    token.attrs = [
      ['src', `${server}/${diagramType}/svg/${encoded}`],
      ['alt', ''],
      ['class', 'uml-diagram prefetch-candidate']
    ]
    token.block = true
    token.children = children
    token.info = fence.params
    token.map = [startLine, fence.nextLine]
    token.markup = fence.markup
    // Carry the source through so the build can render it locally instead of
    // leaving a hotlink to kroki.io.
    token.meta = { diagramType, source: contents }

    state.line = fence.nextLine + (fence.autoClosed ? 1 : 0)
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  md.renderer.rules.kroki = md.renderer.rules.image
}
