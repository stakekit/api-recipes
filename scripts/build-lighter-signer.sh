#!/usr/bin/env bash
# Build the Node WASM signer from elliottech/lighter-go v1.0.10 into vendor/lighter/.
# The binary is gitignored. Needs Go 1.23.1 (mise install go@1.23.1).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/vendor/lighter"
TAG="v1.0.10"
WASM_SHA="43d6fed46144b29e2349d832ada30a37940a125fce461f81f7ebb7b5152457b3"
EXEC_SHA="45ce9dfe7211247544ab6f4268eb8cb5b6f3d5ae602dc3b51447b7eada99c229"

if ! command -v go >/dev/null 2>&1; then
  if command -v mise >/dev/null 2>&1; then
    mise install go@1.23.1 >/dev/null
    export PATH="$HOME/.local/share/mise/installs/go/1.23.1/bin:$PATH"
  fi
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go 1.23.1 is required. Install it with: mise install go@1.23.1" >&2
  exit 1
fi

GO_VERSION="$(go env GOVERSION 2>/dev/null || go version)"
case "$GO_VERSION" in
  *go1.23.*) ;;
  *)
    echo "This build is pinned to Go 1.23 (wasm_exec.js must match). Found: $GO_VERSION" >&2
    exit 1
    ;;
esac

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

git clone --depth 1 --branch "$TAG" https://github.com/elliottech/lighter-go.git "$WORKDIR/lighter-go"
(
  cd "$WORKDIR/lighter-go"
  GOOS=js GOARCH=wasm go build -trimpath -o "$WORKDIR/lighter-signer.wasm" ./wasm/
)
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" "$WORKDIR/wasm_exec.js"

check_sha() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "sha256 mismatch for $(basename "$file")" >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    exit 1
  fi
}

check_sha "$WORKDIR/lighter-signer.wasm" "$WASM_SHA"
check_sha "$WORKDIR/wasm_exec.js" "$EXEC_SHA"

mkdir -p "$OUT"
cp "$WORKDIR/lighter-signer.wasm" "$OUT/lighter-signer.wasm"
cp "$WORKDIR/wasm_exec.js" "$OUT/wasm_exec.js"
echo "Lighter signer written to vendor/lighter/ (gitignored)."
