/**
 * The article tree.
 *
 * wiki.js renders its sidebar tree with Vue. Here the same structure is nested
 * <details>/<summary> elements, which browsers expand and collapse natively --
 * interactive with no script at all. Ancestors of the current page are marked
 * `open` so a reader always lands with their position revealed.
 *
 * One tree per (locale, tier): a reader authenticated for `private` sees the
 * private tree, and never sees that a secret tree exists.
 */

/** Build the nested node structure for one locale+tier slice of the page list. */
export function buildTree (pages) {
  const root = { name: '', title: '', segments: [], page: null, children: new Map() }

  for (const page of pages) {
    const segments = page.path.split('/')
    let node = root
    segments.forEach((segment, i) => {
      if (!node.children.has(segment)) {
        node.children.set(segment, {
          name: segment,
          title: segment,
          segments: segments.slice(0, i + 1),
          page: null,
          children: new Map()
        })
      }
      node = node.children.get(segment)
    })
    node.page = page
    node.title = page.title || node.title
  }

  const toArray = (node) => ({
    ...node,
    children: [...node.children.values()]
      .map(toArray)
      // Folders first, then pages; each group alphabetical by display title,
      // compared with the Italian collator so accented titles sort naturally.
      .sort((a, b) => {
        const aFolder = a.children.length > 0
        const bFolder = b.children.length > 0
        if (aFolder !== bFolder) { return aFolder ? -1 : 1 }
        return a.title.localeCompare(b.title, 'it')
      })
  })

  return toArray(root).children
}

/**
 * Pick the trees a page rendered at `tier` may show.
 *
 * The sidebar lists page titles and URLs, so rendering another tier's tree
 * publishes exactly what that tier exists to withhold. Each page therefore sees
 * only its own tier: a public page cannot reveal that private pages exist, and a
 * private page cannot reveal the secret ones.
 *
 * Unlisted pages fall back to the public tree -- they are reachable without
 * credentials, so anything else would be visible to a link-holder.
 */
export function treesFor (tier, trees) {
  const visible = tier === 'unlisted' ? 'public' : (tier || 'public')
  return trees[visible] ? { [visible]: trees[visible] } : {}
}

/** Group pages into a tree per tier, ready for the sidebar. */
export function treesByTier (pages, locale) {
  const trees = {}
  for (const tier of ['public', 'private', 'secret']) {
    const slice = pages.filter(p => p.locale === locale && p.tier === tier)
    if (slice.length > 0) { trees[tier] = buildTree(slice) }
  }
  return trees
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

/**
 * Render a tree as nested <details>. `currentPath` opens the branch containing
 * the page being viewed and marks it aria-current.
 */
export function renderTree (nodes, currentPath = null, depth = 0) {
  if (!nodes.length) { return '' }

  const items = nodes.map(node => {
    const prefix = node.segments.join('/')
    const onPath = currentPath !== null &&
      (currentPath === prefix || currentPath.startsWith(`${prefix}/`))

    if (node.children.length === 0) {
      const current = currentPath === prefix ? ' aria-current="page"' : ''
      return `<li class="tree-leaf">${
        node.page
          ? `<a href="${escapeHtml(node.page.url)}"${current}>${escapeHtml(node.title)}</a>`
          : `<span>${escapeHtml(node.title)}</span>`
      }</li>`
    }

    // A folder that is also a page gets a link beside its disclosure triangle.
    const summaryLabel = node.page
      ? `<a href="${escapeHtml(node.page.url)}"${currentPath === prefix ? ' aria-current="page"' : ''}>${escapeHtml(node.title)}</a>`
      : escapeHtml(node.title)

    return `<li class="tree-branch"><details${onPath ? ' open' : ''}>` +
      `<summary>${summaryLabel}</summary>` +
      renderTree(node.children, currentPath, depth + 1) +
      '</details></li>'
  })

  return `<ul class="tree tree-depth-${depth}">${items.join('')}</ul>`
}
