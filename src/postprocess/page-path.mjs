/**
 * Port of wiki.js `server/helpers/page.js#parsePath`, which html-core uses to
 * turn a link href into a {locale, path} pair.
 */
import { config } from '../config.mjs'

const localeSegmentRegex = /^[A-Z]{2}(-[A-Z]{2})?$/i
// eslint-disable-next-line no-control-regex
const unsafeCharsRegex = /[\x00-\x1f\x80-\x9f\\"|<>:*?]/

export function parsePath (rawPath) {
  const pathObj = { locale: config.lang.code, path: 'home', explicitLocale: false }

  rawPath = decodeURIComponent(rawPath).trim()
  if (rawPath.startsWith('/')) { rawPath = rawPath.substring(1) }
  rawPath = rawPath.replace(unsafeCharsRegex, '')
  if (rawPath === '') { rawPath = 'home' }
  rawPath = rawPath.replace(/\\/g, '').replace(/\/\//g, '').replace(/\.\.+/ig, '')

  const pathParts = rawPath.split('/')
    .map(p => p.trim())
    .filter(p => p !== '' && p !== '..' && p !== '.')

  if (pathParts.length === 0) { return pathObj }
  // wiki.js drops a leading single-character segment before the locale test.
  if (pathParts[0].length === 1) { pathParts.shift() }
  if (pathParts.length > 0 && localeSegmentRegex.test(pathParts[0])) {
    pathObj.locale = pathParts[0]
    pathObj.explicitLocale = true
    pathParts.shift()
  }

  pathObj.path = pathParts.join('/')
  return pathObj
}
