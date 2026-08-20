# One-time setup

The build pipeline is running and publishing images. Three things still need a
human, because they need tokens only you can mint.

## 1. `UNLISTED_SALT` — back it up now

Already generated and stored as a repository secret on
`ElDavoo/davidepalma-site`. GitHub secrets are write-only, so **you cannot read
it back from there.**

Every unlisted URL is derived from it:

```
segment = base32( HMAC-SHA256(UNLISTED_SALT, "{locale}:{path}") )[0..8]
```

Lose it and every unlisted link anyone has ever been given stops working, all at
once. Keep it in a password manager.

If you ever need to change it, expect every unlisted URL to change with it.

## 2. `CONTENT_TOKEN` — lets CI read the private content repo

Until this exists, builds publish an image **without any private or secret
pages**. The workflow currently tolerates that only because the repository
variable `ALLOW_MISSING_PRIVATE` is set; delete that variable once the token is
in, and the build will fail loudly rather than silently dropping content if the
token ever expires.

Create at **Settings → Developer settings → Personal access tokens → Fine-grained
tokens**:

| Field | Value |
|---|---|
| Name | `davidepalma-site CI — private content` |
| Resource owner | `ElDavoo` |
| Repository access | Only select repositories → `wiki-content-private` |
| Permissions | Repository permissions → **Contents: Read-only** |
| Expiration | your call; the build fails loudly when it lapses |

Then:

```bash
gh secret set CONTENT_TOKEN --repo ElDavoo/davidepalma-site
gh variable delete ALLOW_MISSING_PRIVATE --repo ElDavoo/davidepalma-site
```

## 3. `SITE_DISPATCH_TOKEN` — lets a content push trigger a rebuild

Without it, content changes only reach the site on the daily 04:17 UTC cron (or
a manual `gh workflow run build.yml`).

| Field | Value |
|---|---|
| Name | `content → site rebuild` |
| Resource owner | `ElDavoo` |
| Repository access | Only select repositories → `davidepalma-site` |
| Permissions | Repository permissions → **Contents: Read and write** |

`Contents: write` is what the `repository_dispatch` API requires; it is the
narrowest permission that works.

Set it on **both** content repositories:

```bash
gh secret set SITE_DISPATCH_TOKEN --repo ElDavoo/wikijs-content
gh secret set SITE_DISPATCH_TOKEN --repo ElDavoo/wiki-content-private
```

## 4. Check the GHCR package is private

The image contains **all four tiers**, so it must not be public. Packages pushed
by Actions from a private repository start private, but confirm it:

<https://github.com/users/ElDavoo/packages/container/package/davidepalma-site>
→ Package settings → Danger Zone → visibility should read **Private**.

While you are there, give the Pi a read-only pull token: a classic PAT with just
`read:packages`, used for `docker login ghcr.io` on the Pi.

## 5. Deploy

See [`deploy/README.md`](deploy/README.md). Read the disk warning at the top
first — the Pi's SD card was at 100% with ~466 MB free.

## Verifying it all works

```bash
gh workflow run build.yml --repo ElDavoo/davidepalma-site
gh run watch --repo ElDavoo/davidepalma-site
```

With `CONTENT_TOKEN` in place the end-to-end suite runs 45 checks instead of 40 —
the extra five are the private-tier ones, which have nothing to test until CI can
see the private repo.
