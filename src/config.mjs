/**
 * The wiki.js settings this site reproduces, copied verbatim from the live
 * Postgres `settings` table so rendering matches what davidepalma.it serves today.
 *
 *   settings.lang    {"code":"it","namespacing":true,"namespaces":["it","en"]}
 *   settings.theming {"darkMode":true,"tocPosition":"left"}
 *   settings.host    https://www.davidepalma.it
 */
export const config = {
  host: 'https://www.davidepalma.it',
  lang: { code: 'it', namespacing: true, namespaces: ['it', 'en'] },
  theming: { darkMode: true, tocPosition: 'left' },

  markdownCore: {
    allowHTML: true,
    linkify: true,
    linebreaks: true,
    underline: false,
    typographer: false,
    quotes: 'English'
  },
  htmlCore: {
    absoluteLinks: false,
    openExternalLinkNewTab: false,
    relAttributeExternalLink: 'noreferrer'
  },
  markdownKatex: { useInline: true, useBlocks: true },
  markdownKroki: { server: process.env.KROKI_SERVER || 'https://kroki.io' },
  markdownPlantuml: { server: 'https://plantuml.requarks.io', imageFormat: 'svg' },
  markdownExpandtabs: { tabWidth: 4 },
  markdownSupsub: { subEnabled: true, supEnabled: true },

  // Deliberately NOT enabled, mirroring the live wiki: markdownMultiTable,
  // markdownPivotTable, markdownMathjax, htmlAsciinema, htmlImagePrefetch.
  // it/test.md documents these as "Joplin only" precisely because they are off.
}

export const DEFAULT_LOCALE = config.lang.code
export const LOCALES = config.lang.namespaces
