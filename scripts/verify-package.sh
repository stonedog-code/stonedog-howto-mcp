#!/usr/bin/env bash
# Copyright (C) 2026 StoneDogCode L.L.C.
# SPDX-License-Identifier: Apache-2.0
#
# Prove that what a CONSUMER receives actually works.
#
#   npm run verify:package
#
# Packs the tarball, installs it into a temp directory as a stranger would, and
# RUNS the installed binary. That last step is the point of the whole script.
#
# ## Why running it matters more here than for a library
#
# This package ships compiled `dist/`, and its entry point is a `bin` that an
# MCP client spawns as a child process. Two failure modes follow, and neither
# shows up in a type-check or a unit test:
#
#   1. **The emitted ESM may not load at all.** TypeScript accepts
#      extension-less relative imports in source and does not rewrite them on
#      emit, so `import "./client"` compiles cleanly and then dies at runtime
#      with ERR_MODULE_NOT_FOUND. ts-jest resolves those happily, so the whole
#      test suite passes while the built artefact is unloadable. That is not
#      hypothetical -- it is how this package's first build behaved.
#
#   2. **A missing or unexecutable bin fails inside somebody else's client**,
#      where the error surfaces as "the MCP server did not start" with no clue
#      pointing back here.
#
# So the check below is: install it, run it with NO configuration, and require
# that it fails the RIGHT way -- naming its missing setting, not its own
# modules. A server that cannot find its imports and a server that is missing a
# token both exit 1; only one of them is publishable.
set -euo pipefail

PACKAGE_NAME="@stonedogcode/howto-mcp"
BIN_NAME="stonedog-howto-mcp"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mREFUSING: %s\033[0m\n' "$*" >&2; exit 1; }

say "Building"
npm run build

[ -f dist/index.js ] || fail "dist/index.js does not exist after a build. The bin points at it."

# The shebang is what makes the bin executable when npm links it. tsc preserves
# it only because it is the first line of the source; a stray import above it
# would silently move it and the binary would be spawned as a shell script.
head -1 dist/index.js | grep -q '^#!/usr/bin/env node' \
  || fail "dist/index.js has no '#!/usr/bin/env node' shebang, so npm's bin link will not execute."

say "Packing"
TARBALL="$(npm pack --silent | tail -1)"
[ -f "$TARBALL" ] || fail "npm pack produced no tarball."
trap 'rm -f "$REPO_ROOT/$TARBALL"' EXIT

say "Installing as a consumer"
PROBE_DIR="$(mktemp -d)"
trap 'rm -f "$REPO_ROOT/$TARBALL"; rm -rf "$PROBE_DIR"' EXIT

printf '{"name":"probe","version":"1.0.0","private":true}' > "$PROBE_DIR/package.json"
(cd "$PROBE_DIR" && npm install --silent --no-audit --no-fund "$REPO_ROOT/$TARBALL" >/dev/null)

INSTALLED="$PROBE_DIR/node_modules/$PACKAGE_NAME"
[ -d "$INSTALLED" ] || fail "the package did not install."

for path in dist/index.js dist/client.js dist/tools.js LICENSE NOTICE README.md; do
  [ -f "$INSTALLED/$path" ] || fail "'$path' is missing from the INSTALLED package."
done

# It ships compiled output. Shipping src/ as well would double the tarball and
# publish the tests, which import jest globals that are not dependencies.
[ ! -d "$INSTALLED/src" ] || fail "the installed package contains src/. This package ships dist/ only."
[ ! -d "$INSTALLED/dist/__tests__" ] || fail "the installed package contains tests."

BIN_LINK="$PROBE_DIR/node_modules/.bin/$BIN_NAME"
[ -x "$BIN_LINK" ] || fail "npm did not create an executable '$BIN_NAME' bin link."

# ---------------------------------------------------------------------------
# The check this script exists for: RUN it.
#
# With no configuration, so it exits immediately and predictably. What is being
# asserted is the SHAPE of the failure — that it got far enough to read its own
# environment, which means every module resolved.
# ---------------------------------------------------------------------------
say "Running the installed binary"
set +e
OUTPUT="$("$BIN_LINK" 2>&1 </dev/null)"
STATUS=$?
set -e

printf '%s\n' "$OUTPUT" | grep -qiE 'ERR_MODULE_NOT_FOUND|Cannot find (module|package)' \
  && fail "the installed server cannot load its own modules:
$OUTPUT

This is the extension-less-import trap: tsc accepts \`import \"./client\"\` and does
not rewrite it on emit, while ts-jest resolves it happily. Use NodeNext and
import with a .js extension."

[ "$STATUS" -ne 0 ] \
  || fail "the server exited 0 with no configuration. It should refuse to start and say which setting is missing."

printf '%s' "$OUTPUT" | grep -q 'HOWTO_PORTAL_URL' \
  || fail "the server failed without naming the setting it needs. Its output was:
$OUTPUT"

echo "  starts, resolves every module, and refuses to run unconfigured:"
printf '    %s\n' "$OUTPUT"

printf '\n\033[32m✓ the packaged server installs, links its bin, and runs.\033[0m\n'
