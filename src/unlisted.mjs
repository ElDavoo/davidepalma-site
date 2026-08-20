/**
 * Unguessable URL segments for unlisted pages.
 *
 * An unlisted page is reachable by anyone holding its link and by nobody else:
 * it is absent from the tree, the search index and the sitemap, and it carries
 * X-Robots-Tag: noindex. The path segment therefore has to be unguessable, which
 * a readable slug is not.
 *
 * The segment is derived rather than random, so it is STABLE across rebuilds --
 * essential, because a random segment would break every shared link on every
 * deploy. That makes UNLISTED_SALT a value to back up: losing it changes every
 * unlisted URL at once.
 *
 * 40 bits (8 base32 characters) is short enough to paste into a chat message and
 * still leaves ~1.1e12 possibilities. Guessing one by brute force means ~5e11
 * expected requests against a Raspberry Pi behind Cloudflare; that is not a
 * realistic attack, and this tier is "not linked", not "protected". Content
 * needing an actual access decision belongs in the private or secret tier.
 */
import crypto from 'node:crypto'

// RFC 4648 base32, lowercased: unambiguous in URLs and case-insensitive to type.
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'
const SEGMENT_LENGTH = 8

function base32 (buf, chars) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
      if (out.length === chars) { return out }
    }
  }
  if (bits > 0 && out.length < chars) { out += BASE32[(value << (5 - bits)) & 31] }
  return out.slice(0, chars)
}

/**
 * @param {string} locale
 * @param {string} pagePath
 * @param {string} salt  UNLISTED_SALT
 * @returns {string} 8 lowercase base32 characters
 */
export function unlistedSegment (locale, pagePath, salt) {
  if (!salt) {
    throw new Error('UNLISTED_SALT is not set: refusing to derive unlisted URLs from an empty secret')
  }
  const mac = crypto.createHmac('sha256', salt).update(`${locale}:${pagePath}`).digest()
  return base32(mac, SEGMENT_LENGTH)
}

export const UNLISTED_SEGMENT_LENGTH = SEGMENT_LENGTH
