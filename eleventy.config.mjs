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

  eleventyConfig.setServerOptions({
    port: Number(process.env.PORT) || 8080,
    showAllHosts: false
  })

  return {
    dir: { input: 'src/site', output: '_site', data: '_data', includes: '../../templates' },
    templateFormats: ['11ty.js']
  }
}
