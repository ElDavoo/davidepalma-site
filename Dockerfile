# syntax=docker/dockerfile:1
#
# The site image: a static Go server plus the pre-rendered site.
#
# The Eleventy build runs in CI rather than here, because it needs a Kroki
# service container to render diagrams and checkouts of both content
# repositories. CI leaves its output in dist/, which this image copies.
#
# Go cross-compiles, so the builder stage stays on the native platform and
# targets $TARGETARCH -- no QEMU emulation for an arm64 Raspberry Pi image.

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETARCH
WORKDIR /src
COPY server/go.mod server/go.sum* ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags='-s -w' -o /out/site-server .

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/site-server /site-server

# dist/site is the web root; dist/data holds manifest.json, the search index and
# the search shells. Keeping them apart means the files that name every private
# and secret URL are not in the directory the file server can reach.
COPY dist/site /srv/site
COPY dist/data /srv/data

ENV SITE_DIR=/srv/site \
    DATA_DIR=/srv/data \
    LISTEN=:8080

EXPOSE 8080
USER nonroot:nonroot

# The image has no shell, so the binary probes itself.
HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/site-server", "-healthcheck"]

ENTRYPOINT ["/site-server"]
