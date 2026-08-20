#!/usr/bin/env bash
# Local diagram renderer for the authoring loop.
#
# Runs the same two images CI uses, so a diagram previews exactly as it will
# publish. Rootless Podman, so no daemon and no system configuration.
#
# Needed because kroki.io's public mermaid backend is unreliable (it answers
# 500). Every other diagram type works against kroki.io, so this is only
# required if you are editing mermaid.
#
#   tools/kroki.sh start | stop | status
set -euo pipefail

POD=kroki-local
PORT=${KROKI_PORT:-8000}
KROKI_IMAGE=docker.io/yuzutech/kroki:latest
MERMAID_IMAGE=docker.io/yuzutech/kroki-mermaid:latest

# Podman is in the devShell; Docker works identically if you happen to have it.
RUNTIME="${CONTAINER_RUNTIME:-}"
if [ -z "$RUNTIME" ]; then
  if command -v podman >/dev/null 2>&1; then RUNTIME=podman
  elif command -v docker >/dev/null 2>&1; then RUNTIME=docker
  else
    echo "no container runtime found. Run inside 'nix develop', which provides podman." >&2
    exit 1
  fi
fi
podman() { command "$RUNTIME" "$@"; }

# NixOS only installs /etc/containers/policy.json when containers are enabled
# system-wide. Without it podman refuses to do anything at all, so provide the
# standard permissive default at user level -- the same one Debian and Fedora
# ship. This is the only thing this script writes outside the project.
ensure_policy() {
  [ "$RUNTIME" = podman ] || return 0
  local policy="${HOME}/.config/containers/policy.json"
  [ -f "$policy" ] || [ -f /etc/containers/policy.json ] && return 0
  mkdir -p "$(dirname "$policy")"
  printf '{\n  "default": [{"type": "insecureAcceptAnything"}]\n}\n' > "$policy"
  echo "created $policy (podman requires it; NixOS omits it unless containers are enabled system-wide)"
}

case "${1:-status}" in
  start)
    ensure_policy
    if ! podman pod exists "$POD" 2>/dev/null; then
      podman pod create --name "$POD" -p "127.0.0.1:${PORT}:8000" >/dev/null
    fi
    # One pod, so the two containers share a network namespace and kroki can
    # reach the mermaid companion on localhost.
    podman container exists "${POD}-mermaid" 2>/dev/null || \
      podman run -d --pod "$POD" --name "${POD}-mermaid" "$MERMAID_IMAGE" >/dev/null
    podman container exists "${POD}-kroki" 2>/dev/null || \
      podman run -d --pod "$POD" --name "${POD}-kroki" \
        -e KROKI_MERMAID_HOST=localhost -e KROKI_MERMAID_PORT=8002 "$KROKI_IMAGE" >/dev/null
    podman start "${POD}-mermaid" "${POD}-kroki" >/dev/null 2>&1 || true

    printf 'waiting for kroki on 127.0.0.1:%s ' "$PORT"
    for _ in $(seq 1 60); do
      if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
        echo " ready"
        echo "now run:  KROKI_SERVER=http://127.0.0.1:${PORT} npm run dev"
        exit 0
      fi
      printf .; sleep 2
    done
    echo " timed out"; exit 1
    ;;
  stop)
    podman pod rm -f "$POD" >/dev/null 2>&1 || true
    echo "stopped"
    ;;
  status)
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
      echo "kroki is up on http://127.0.0.1:${PORT}"
    else
      echo "kroki is not running (tools/kroki.sh start)"
    fi
    ;;
  *)
    echo "usage: tools/kroki.sh {start|stop|status}" >&2; exit 2 ;;
esac
