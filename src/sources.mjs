/**
 * Where content comes from, and where each source's files end up.
 *
 * Paths are resolved from the environment so the same build runs from a
 * developer checkout (sibling directories) and from CI (whatever the workflow
 * checked out).
 */
import path from 'node:path'

const resolve = (p, fallback) => path.resolve(p || fallback)

export function contentSources (root = process.cwd()) {
  return [
    {
      name: 'public',
      dir: resolve(process.env.CONTENT_PUBLIC, path.join(root, '..', 'wikijs-content')),
      defaultTier: 'public',
      // Non-markdown files keep their path, so today's asset URLs (for example
      // /be862e69f078cd7785139658178f5aaa.png) keep resolving.
      assetPrefix: ''
    },
    {
      name: 'private',
      dir: resolve(process.env.CONTENT_PRIVATE, path.join(root, '..', 'wiki-content-private')),
      defaultTier: 'private',
      // Assets from the private repo are published behind basic auth. nginx
      // gates /private/…, so putting them there means an image cannot leak just
      // because it sits next to a protected page.
      assetPrefix: 'private'
    }
  ]
}
