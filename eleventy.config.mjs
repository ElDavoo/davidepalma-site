/**
 * Eleventy build.
 *
 * Templates are plain JS (`.11ty.mjs`) rather than a template language: every
 * byte of emitted HTML comes from code in templates/ and src/site/, so "does the
 * output contain a <script>?" is answerable by reading, and enforced by
 * tools/check-no-js.mjs.
 */
import path from 'node:path'
import { contentSources } from './src/sources.mjs'
import { copyContentAssets, copyUsedTwemoji } from './src/assets.mjs'
import { devMiddleware } from './src/dev-middleware.mjs'
import { DEFAULT_LOCALE, LOCALES } from './src/config.mjs'

const ROOT = import.meta.dirname

export default function (eleventyConfig) {
  const sources = contentSources(ROOT)

  // Stylesheets. KaTeX's CSS resolves its fonts relative to itself, so it has to
  // land beside a fonts/ directory.
  eleventyConfig.addPassthroughCopy({ 'styles/site.css': '_assets/site.css' })
  eleventyConfig.addPassthroughCopy({ 'node_modules/katex/dist/katex.min.css': '_assets/katex.css' })
  eleventyConfig.addPassthroughCopy({ 'node_modules/katex/dist/fonts': '_assets/fonts' })

  for (const source of sources) {
    eleventyConfig.addWatchTarget(source.dir)
  }

  // Content assets are copied in an after-hook rather than by passthrough copy:
  // Eleventy will not reach outside the project directory, and the content
  // repositories are siblings of this one.
  eleventyConfig.on('eleventy.after', async ({ dir }) => {
    const out = path.resolve(dir.output)
    const copied = await copyContentAssets(out, sources)
    const emoji = await copyUsedTwemoji(out, path.join(ROOT, 'node_modules/@twemoji/svg'))
    const summary = Object.entries(copied).map(([name, n]) => `${n} from ${name}`).join(', ')
    console.log(`[assets] ${summary}; ${emoji} emoji`)
  })

  eleventyConfig.addWatchTarget('./styles/')
  eleventyConfig.addWatchTarget('./templates/')
  eleventyConfig.addWatchTarget('./src/')

  // The dev server must resolve URLs the way the production server does, or a
  // link that works locally would 404 in production (and vice versa).
  eleventyConfig.setServerOptions({
    port: Number(process.env.PORT) || 8080,
    showAllHosts: false,
    middleware: [
      devMiddleware({
        outputDir: path.join(ROOT, '_site'),
        defaultLocale: DEFAULT_LOCALE,
        locales: LOCALES,
        // tools/dev.mjs sets this to a real Go server, so dev search is the
        // implementation that ships rather than a lookalike.
        searchUrl: process.env.DEV_SEARCH_URL || null
      })
    ]
  })

  return {
    dir: { input: 'src/site', output: '_site', data: '_data', includes: '../../templates' },
    templateFormats: ['11ty.js']
  }
}
