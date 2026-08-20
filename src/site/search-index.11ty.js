/** search-index.json — inverted index over public pages, loaded at server start. */
export const data = { permalink: 'search-index.json', eleventyExcludeFromCollections: true }
export function render (data) {
  return JSON.stringify(data.wiki.searchIndex)
}
