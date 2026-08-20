/**
 * Copy static files into the build output.
 *
 * Eleventy's passthrough copy will not reach outside the project directory, and
 * the content repositories are siblings, so this runs as an `eleventy.after`
 * hook instead. It also lets us ship only the emoji a page actually uses.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** Repo furniture that should not be published even though it is not markdown. */
const SKIP_NAMES = new Set(['readme.md', 'license', 'license.md', 'licence.md', '.gitignore', '.gitattributes'])

async function copyTree (from, to, { onFile } = {}) {
  let entries
  try {
    entries = await fs.readdir(from, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') { return 0 }
    throw err
  }

  let count = 0
  for (const entry of entries) {
    if (entry.name.startsWith('.')) { continue }
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)

    if (entry.isDirectory()) {
      count += await copyTree(src, dest, { onFile })
    } else if (entry.isFile()) {
      // Markdown is rendered, not copied.
      if (entry.name.endsWith('.md')) { continue }
      if (SKIP_NAMES.has(entry.name.toLowerCase())) { continue }
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.copyFile(src, dest)
      onFile?.(dest)
      count++
    }
  }
  return count
}

/**
 * Public-repo assets keep their existing URLs (so /icona_palma.png and friends
 * keep resolving); private-repo assets land under /private/, which nginx gates.
 */
export async function copyContentAssets (outDir, sources) {
  const copied = {}
  for (const source of sources) {
    const target = path.join(outDir, source.assetPrefix || '')
    copied[source.name] = await copyTree(source.dir, target)
  }
  return copied
}

/**
 * markdown-it-emoji renders :smile: as an <img> pointing at
 * /_assets/svg/twemoji/{codepoints}.svg -- the same path wiki.js uses, so emoji
 * keep working without depending on the reader having a colour emoji font.
 *
 * The full Twemoji set is ~17 MB for what is currently a single emoji, so we
 * scan the built HTML and copy only what is referenced.
 */
export async function copyUsedTwemoji (outDir, twemojiDir) {
  const referenced = new Set()

  const scan = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { await scan(full) } else if (entry.name.endsWith('.html')) {
        const html = await fs.readFile(full, 'utf8')
        for (const m of html.matchAll(/\/_assets\/svg\/twemoji\/([0-9a-f-]+)\.svg/g)) {
          referenced.add(m[1])
        }
      }
    }
  }
  await scan(outDir)

  if (referenced.size === 0) { return 0 }

  const target = path.join(outDir, '_assets/svg/twemoji')
  await fs.mkdir(target, { recursive: true })

  let copied = 0
  for (const code of referenced) {
    try {
      await fs.copyFile(path.join(twemojiDir, `${code}.svg`), path.join(target, `${code}.svg`))
      copied++
    } catch (err) {
      if (err.code !== 'ENOENT') { throw err }
      console.warn(`[assets] no twemoji asset for ${code}`)
    }
  }
  return copied
}
