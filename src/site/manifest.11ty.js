/**
 * manifest.json — the tier of every URL, for the Go server.
 *
 * nginx decides which credentials a request presented; the server independently
 * decides whether the requested page is allowed at that level. Both have to
 * agree, so a mistake in either one alone cannot serve protected content.
 */
export const data = { permalink: 'manifest.json', eleventyExcludeFromCollections: true }
export function render (data) {
  return JSON.stringify(data.wiki.manifest, null, 2)
}
