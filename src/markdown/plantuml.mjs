/**
 * PlantUML fence, ported from wiki.js
 * `server/modules/rendering/markdown-plantuml/renderer.js`.
 *
 * PlantUML servers use their own base64 alphabet over a raw-deflate stream,
 * which is why this cannot just call Buffer#toString('base64').
 */
import zlib from 'node:zlib'
import { scanFence, altTokens } from './fence-scanner.mjs'

export function plantumlPlugin (md, conf = {}) {
  const openMarker = conf.openMarker || '```plantuml'
  const closeMarker = conf.closeMarker || '```'
  const imageFormat = conf.imageFormat || 'svg'
  const server = conf.server || 'https://plantuml.requarks.io'

  md.block.ruler.before('fence', 'uml_diagram', (state, startLine, endLine, silent) => {
    const fence = scanFence(state, startLine, endLine, openMarker, closeMarker)
    if (!fence) { return false }
    if (silent) { return true }

    const children = altTokens(state, fence.params)
    const source = '@startuml\n' + fence.contents + '\n@enduml'
    const zippedCode = encode64(zlib.deflateRawSync(source).toString('binary'))

    const token = state.push('uml_diagram', 'img', 0)
    token.attrs = [
      ['src', `${server}/${imageFormat}/${zippedCode}`],
      ['alt', ''],
      ['class', 'uml-diagram prefetch-candidate']
    ]
    token.block = true
    token.children = children
    token.info = fence.params
    token.map = [startLine, fence.nextLine]
    token.markup = fence.markup
    token.meta = { diagramType: 'plantuml', source }

    state.line = fence.nextLine + (fence.autoClosed ? 1 : 0)
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  md.renderer.rules.uml_diagram = md.renderer.rules.image
}

// PlantUML's variant of base64 (digits, upper, lower, '-', '_').
function encode64 (data) {
  let r = ''
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) {
      r += append3bytes(data.charCodeAt(i), data.charCodeAt(i + 1), 0)
    } else if (i + 1 === data.length) {
      r += append3bytes(data.charCodeAt(i), 0, 0)
    } else {
      r += append3bytes(data.charCodeAt(i), data.charCodeAt(i + 1), data.charCodeAt(i + 2))
    }
  }
  return r
}

function append3bytes (b1, b2, b3) {
  const c1 = b1 >> 2
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
  const c3 = ((b2 & 0xF) << 2) | (b3 >> 6)
  const c4 = b3 & 0x3F
  return encode6bit(c1 & 0x3F) + encode6bit(c2 & 0x3F) + encode6bit(c3 & 0x3F) + encode6bit(c4 & 0x3F)
}

function encode6bit (raw) {
  let b = raw
  if (b < 10) { return String.fromCharCode(48 + b) }
  b -= 10
  if (b < 26) { return String.fromCharCode(65 + b) }
  b -= 26
  if (b < 26) { return String.fromCharCode(97 + b) }
  b -= 26
  if (b === 0) { return '-' }
  if (b === 1) { return '_' }
  return '?'
}
