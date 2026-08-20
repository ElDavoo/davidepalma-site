# davidepalma-site

A static, **zero-client-JavaScript** replacement for the wiki.js site at
[www.davidepalma.it](https://www.davidepalma.it).

wiki.js renders beautifully but is a server application whose *reading*
experience needs a browser runtime: the page shell, the navigation tree, tabsets
and diagrams are all Vue. This project renders the same content to plain HTML at
build time and serves it from a small Go binary.

## Why an earlier Hugo attempt did not work

wiki.js renders in two stages:

1. **markdown-it** (v11) with a specific plugin set, then
2. a **cheerio pass over the resulting HTML** (`html-core`) that classifies
   links, adds `uslug` heading anchors, wraps stray root nodes and expands
   tabsets.

Hugo's Goldmark is a different markdown dialect *and* Hugo has no HTML
post-processing stage, so stage 2 cannot be expressed there at all. Eleventy uses
markdown-it natively, so the same plugins install and stage 2 ports over almost
verbatim.

The other half of the answer is that most of wiki.js's rendering is *already*
server-side: KaTeX emits static HTML and Kroki diagrams are plain `<img>` tags.
Only three things genuinely needed a browser, and each has a build-time
replacement:

| wiki.js | here |
|---|---|
| Prism highlights in the browser | highlight.js at build time |
| Mermaid runtime renders `<div class="mermaid">` | SVG inlined at build time via Kroki |
| Vue `<tabset>` custom element | radio inputs + the general-sibling combinator |

## Verified against the real thing

`npm run parity` renders every page and diffs it against the `pages.render` HTML
**wiki.js itself produced**, exported from the live database. All ten pages
match — tabsets, kroki fences, footnotes, KaTeX (including mhchem), task lists,
twemoji, `{.is-info}` attributes and heading anchors. Because heading anchors are
generated with the same `uslug` algorithm, existing `#anchor` links keep working.

This is the objective check the earlier attempt never had, and it is what makes
it safe to run current dependency versions rather than freezing them: a bump that
changes rendering fails here.

Three differences are normalised, each for a stated reason. wiki.js runs its
output through DOMPurify, whose MathML allow-list strips KaTeX's
`<semantics>`/`<annotation>` wrapper — we keep it, because it carries the
original LaTeX for screen readers. Kroki URLs embed a zlib stream whose bytes
vary by zlib build, so they are compared by decoded meaning. And KaTeX's
`.katex-html` subtree is presentation, regenerated per release from the same
parse the MathML describes; the MathML itself is compared in full.

## Layout

```
src/markdown/      markdown-it instance + the wiki.js plugin ports
src/postprocess/   html-core (cheerio), the no-JS transforms, diagram inlining
src/site/          Eleventy templates and the global data file
templates/         the page shell
styles/            one stylesheet; dark mode via prefers-color-scheme
server/            the Go server: URL resolution, tier enforcement, search
tools/             export, parity, verification, dev loop
deploy/            nginx and compose fragments, and the cutover runbook
```

## Access tiers

| Tier | URL | Auth | In tree | In search | In sitemap |
|---|---|---|---|---|---|
| `public` | `/{locale}/{path}` | none | yes | yes | yes |
| `unlisted` | `/{locale}/u/{hash}` | none | no | no | no, `noindex` |
| `private` | `/{locale}/private/{path}` | basic auth | own tier only | no | no |
| `secret` | `/{locale}/secret/{path}` | separate credentials | own tier only | no | no |

A page's tier comes from `access:` in its frontmatter and defaults to its source
repository. **A file in the public repo cannot claim a protected tier** — its
source is already public, and allowing that would make something look protected
when it is not.

Unlisted segments are `HMAC-SHA256(UNLISTED_SALT, "{locale}:{path}")` truncated
to 8 base32 characters. They are *derived*, not random, so a URL stays stable
across rebuilds — a random one would break every shared link on every deploy.
That makes `UNLISTED_SALT` a value to back up. Because unlisted URLs are
unguessable they are also unfindable by their author, so the build publishes an
index of them at `/secret/unlisted`, behind the secret credentials.

**Enforcement happens twice.** nginx decides which credentials were presented and
sets `X-Auth-Tier` unconditionally on every proxying location, so a client cannot
forge it. The server independently checks that header against the page's tier in
the build manifest and returns 404 on a mismatch — 404 rather than 403, because
403 would confirm the page exists. A mistake in either layer alone cannot leak
anything.

## Working on it

```bash
nix develop            # node, go, psql, htpasswd
npm ci
npm run dev            # http://localhost:8080, hot reload
```

`npm run dev` runs the real Go server beside Eleventy and proxies `/search` to
it, so search in dev is the implementation that ships. Every tier is served
unauthenticated locally, behind a visible banner.

Diagrams need a Kroki server. kroki.io works for most types but its public
mermaid backend is unreliable, so for mermaid run one locally:

```bash
docker compose -f docker-compose.dev.yml up -d
KROKI_SERVER=http://localhost:8000 npm run dev
```

Open the preview beside the markdown with **Simple Browser: Show** →
`http://localhost:8080`, or the Live Preview extension. Save the `.md`, the pane
refreshes.

### Checks

```bash
npm run parity          # rendering matches wiki.js's own output
npm run check:nojs      # no <script>, no inline handlers, no javascript: URLs
npm run check:links     # internal links, images and #anchors
npm run verify          # 45 end-to-end checks against a running server
cd server && go test ./...
```

CI runs all of these, plus a check that unlisted URLs are byte-stable across two
consecutive builds.

## This repository is public. The content is not.

Only the generator lives here. Nothing in this repository is secret, and CI is
built so that nothing secret ends up in a public build log or artifact:

- **Build output is quiet.** Eleventy is run with `--quiet`, because it otherwise
  logs the path of every file it writes — which would list every private and
  secret page.
- **Unlisted URLs are compared by digest, never printed.** An unlisted URL in a
  public log is an unlisted URL no longer.
- **Failure output is redacted.** `tools/verify.mjs` and
  `tools/check-links.mjs --redact-protected` replace protected paths and titles
  with a tier label, so a broken link inside a private page is still reported —
  as `<private page>: link -> …` — without publishing its address.
- **Warnings name the repository, not the file.** A problem with a file in the
  private content repo is reported without the filename.
- **The workflow artifact is public pages only**, staged by deleting the
  protected trees and then *verifying against the manifest* that none survived.
  Artifacts on a public repository are downloadable by anyone.
- **The image stays private.** It contains all four tiers; the GHCR package must
  not be made public.

The unlisted-URL scheme is published here in full, deliberately. Its security
rests on `UNLISTED_SALT`, which is a repository secret — not on the algorithm
being unknown.

## Content

Two repositories, because gating applies to published pages, not to git history:

- [`ElDavoo/wikijs-content`](https://github.com/ElDavoo/wikijs-content) — public, `public` + `unlisted`
- `ElDavoo/wiki-content-private` — private, `private` + `secret`

Both fire a `repository_dispatch` at this repository on push, which rebuilds and
publishes the image. The Pi polls for it.

## Known content defects (inherited, not introduced)

`npm run check:links` reports three problems that exist on the live wiki too:

- `en/home.md` links to `/en/private/test`, which was never created (the wiki
  answers 403). A placeholder now exists in the private repo — replace it or drop
  the link.
- `step_traccia_teoria` references `media/image1.png`, which 404s live: a
  leftover from a Word conversion.
- `it/test` has four hand-written footnote anchors (`#fn1`, `#fn2`, `#fnref1`,
  `#fnref2`) pointing at IDs nothing generates, because the page uses a manual
  list rather than footnote syntax.

## Dependencies

Everything is kept current. Rendering parity is protected by `npm run parity`,
which compares every page against wiki.js's own stored output — so an upgrade
that changes rendering fails CI instead of shipping quietly.

Three upgrades have changed rendering so far, and each was decided on its merits
rather than pinned away:

| Change | Decision |
|---|---|
| markdown-it 12 flipped `fuzzyLink` to `false`, dropping a link on `it/home` | restored in `src/markdown/pipeline.mjs` |
| markdown-it-attrs 5 moved trailing `{.is-info}` onto the inner paragraph, breaking blockquote styling | restored in `src/postprocess/blockquotes.mjs` |
| KaTeX 0.18 fixed mhchem, so `$\ce{...}$` renders instead of printing `\ce` | accepted; recorded as an intended difference |

That last one means the new site is *more* correct than the wiki on `it/test`.

## Deliberately not ported

`markdownMultiTable`, `markdownPivotTable` and `markdownMathjax` are **disabled**
on the live wiki. `it/test.md` lists multimd tables and definition lists as
"Joplin only" precisely because they do not render today. Enabling them here
would make the new site render pages the old one does not.

`asciidocCore` and `openapiCore` are enabled upstream but unused by any page.

Comments are dropped, as agreed; the `enable-comments` / `disable-comments` tags
are ignored.

Dark mode is automatic only. A *manual* override that persisted between pages
needs JavaScript or a cookie round-trip, so it is out of scope under the no-JS
rule.
