#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .artifacts
stage=$(mktemp -d "$PWD/.artifacts/ewaste-tests.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
pnpm exec tsc --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --outDir "$stage" tests/integration.test.ts tests/playback.test.ts tests/catalog.test.ts tests/metadata.test.ts
printf '{"type":"module"}\n' > "$stage/package.json"
remote_dir=$(ssh -o BatchMode=yes ewaste 'mktemp -d "$HOME/kathrine-verification.XXXXXXXX"')
if [[ ! "$remote_dir" =~ ^/home/nosa/kathrine-verification\.[A-Za-z0-9]+$ ]]; then
  printf 'Unexpected verification directory: %s\n' "$remote_dir" >&2
  exit 1
fi
rsync -az "$stage/" "ewaste:$remote_dir/"
ssh -o BatchMode=yes ewaste bash -s -- "$remote_dir" <<'REMOTE'
set -euo pipefail
verification_dir=$1
case "$verification_dir" in "$HOME"/kathrine-verification.*) ;; *) exit 1 ;; esac
trap 'rm -rf -- "$verification_dir"' EXIT
ln -s "$HOME/kathrine/current/node_modules" "$verification_dir/node_modules"
cd "$verification_dir"
"$HOME/.local/bin/node" --test tests/*.test.js
REMOTE
