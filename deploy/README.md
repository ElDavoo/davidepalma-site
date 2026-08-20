# Deploying to the Raspberry Pi

The site runs as one container (`site`) on the existing `nginx-wiki` network,
behind SWAG. Nothing else on the Pi changes.

## Before you start

**The SD card is full.** At the time of writing `/` was at 100% with ~466 MB
free, and Docker's root directory is `/var/lib/docker` on that same card. The
site image is small (distroless plus a couple of megabytes of content, so tens
of megabytes), and it will fit — but there is no room for a mistake, and a
`docker pull` that fills the card will take the rest of the stack down with it.
Free some space first:

```bash
docker image prune -a          # unused images
docker builder prune           # build cache
journalctl --vacuum-size=100M
```

Retiring `requarks/wiki:2` after cutover recovers a few hundred megabytes on its
own.

## One-time setup

### 1. Credentials for the protected tiers

Two separate files: the point of the secret tier is that it does not share
credentials with the private one.

```bash
docker exec -it nginx htpasswd -B -c /config/nginx/.htpasswd-private davide
docker exec -it nginx htpasswd -B -c /config/nginx/.htpasswd-secret  davide
```

### 2. GHCR pull credentials

The package is private, because the image contains all four tiers. Log the Pi's
Docker in with a GitHub token that has `read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u ElDavoo --password-stdin
```

### 3. nginx

Copy `davidepalma-site.subfolder.conf` to
`~/docker/nginx/nginx/proxy-confs/davidepalma-site.subfolder.conf`. SWAG's
`default.conf` already includes `proxy-confs/*.subfolder.conf` inside the server
block, so no edit is needed for the protected tiers.

Then replace the body of `location / { … }` in
`~/docker/nginx/nginx/site-confs/default.conf` with `location-root.conf`. The
only changes are the upstream (`wiki:3000` → `site:8080`) and the added
`proxy_set_header X-Auth-Tier public;`.

Leave the other locations alone. In particular `location ^~ /_assets/favicons`
does not collide with the site's `/_assets/site.css`, `/_assets/katex.css`,
`/_assets/fonts/` or `/_assets/svg/twemoji/`: it is a prefix match on
`/_assets/favicons` specifically.

### 4. Compose

Add the `site` service from `compose-site.yml` to `~/docker/docker-compose.yml`.
Keep `wiki` and `postgres` defined but stopped until you are happy with the
cutover — rollback is then one line in `location /` plus `docker compose up -d wiki`.

## Cutover

```bash
cd ~/docker
docker compose pull site
docker compose up -d site
docker compose exec nginx nginx -t     # check the config parses
docker compose restart nginx
```

Then verify from outside:

```bash
# every URL the wiki serves today must still answer 200
for u in /it/home /it/cose-da-fare /it/test /it/tips-uni /en/home /en/spam \
         /en/money-jungle-privacy-policy; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' https://www.davidepalma.it$u)" "$u"
done

# protected tiers
curl -s -o /dev/null -w 'no creds: %{http_code}\n'  https://www.davidepalma.it/it/private/test
curl -s -o /dev/null -w 'with creds: %{http_code}\n' -u davide https://www.davidepalma.it/it/private/test

# a forged header must not get past the server's own check
curl -s -o /dev/null -w 'forged: %{http_code}\n' \
  -H 'X-Auth-Tier: secret' https://www.davidepalma.it/it/private/test
```

`tools/verify.mjs --base https://www.davidepalma.it` runs the full suite against
the live site, though the tier checks will exercise nginx rather than a forged
header.

## Keeping it updated

CI publishes a new image whenever either content repository changes. The Pi
polls for it:

```cron
*/15 * * * * cd /home/dave/docker && docker compose pull -q site && docker compose up -d site
```

`pull_policy: always` plus `up -d` is a no-op when the digest has not changed, so
this is cheap.

## Rollback

```bash
# restore location / to  set $upstream_app wiki;  set $upstream_port 3000;
docker compose up -d wiki
docker compose restart nginx
```

## After you are satisfied

1. `docker compose stop wiki` and remove the service.
2. **Rotate the GitHub deploy key.** wiki.js stores it in plaintext in
   `settings.storage.config.sshPrivateKeyContent` in Postgres, and it was read
   out during this migration. Delete it from the repository's deploy keys on
   GitHub; nothing needs it any more, because content now flows GitHub → CI → image
   rather than wiki → GitHub.
3. The Postgres `wikijs` database can be dropped once you are sure nothing else
   needs it. Take a dump first.
4. Consider whether `add_header X-Robots-Tag none always;` in `default.conf` is
   what you want. It is SWAG's default and it tells crawlers not to index
   *anything* on the site, which makes `/sitemap.xml` moot. It is unchanged by
   this migration — flagging it because the new site generates a sitemap and sets
   per-page `noindex` only where a page is actually protected.
