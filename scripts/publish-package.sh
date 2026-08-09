#!/usr/bin/env bash
# Copyright (C) 2026 StoneDogCode L.L.C.
# SPDX-License-Identifier: Apache-2.0
#
# Publish @stonedogcode/howto-mcp to npm, end to end.
#
#   npm run publish:howto-mcp
#
# Run it from a terminal, interactively. npm prompts for the 2FA one-time
# password itself and the browser login flow needs a human — neither works
# unattended, which is why this is a script you run rather than a step in CI.
#
# Modelled on the sibling packages' scripts of the same shape, and it keeps
# their central lesson: a publish that prints no error can still have published
# nothing, or the wrong thing. So this reads the tarball before publishing and
# installs from the registry afterwards, because "the registry lists it" and "a
# user can install it" are different claims, and the second is the last to
# start answering yes.
#
# ## The traps specific to THIS package
#
# 1. **It ships COMPILED output**, unlike the packages that ship TypeScript
#    source. So the tarball can be perfectly well-formed and still contain a
#    stale `dist/` from an older commit. `verify:package` rebuilds before
#    packing rather than trusting whatever is on disk.
#
# 2. **Its entry point is a `bin` that another program spawns.** A missing
#    file, a lost shebang, or an unloadable module surfaces inside somebody
#    else's MCP client as "the server did not start", with nothing pointing
#    back here. So the packaged binary is installed and RUN before publishing.
#
# 3. **The emitted ESM must actually load.** TypeScript accepts extension-less
#    relative imports and does not rewrite them on emit, while ts-jest resolves
#    them happily — so a green gate can sit on top of a build Node refuses to
#    start. This package's first build did exactly that. `verify:package`
#    catches it; nothing else does.
#
# 4. **A version may be published at most once, ever.** npm refuses to
#    republish over one, so a mistake costs a version number permanently.
set -euo pipefail

PACKAGE_NAME="@stonedogcode/howto-mcp"
# Sanity floor for the tarball. Comfortably under the real count so ordinary
# growth does not trip it, far above what a `files`-misconfigured package would
# produce (3: package.json, README, LICENSE).
MIN_FILES=8
# Everything the manifest points at: the bin target, its imports, and the
# type declarations a TypeScript consumer resolves.
REQUIRED_PATHS=("dist/index.js" "dist/client.js" "dist/tools.js" "dist/index.d.ts")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mREFUSING: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Publish from a clean, current `main`.
# ---------------------------------------------------------------------------
say "Checking the working tree"
BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || fail "this checkout is in detached HEAD. Run: git checkout main && git pull"
[ "$BRANCH" = "main" ] || fail "on branch '$BRANCH'. Publish from main, never a feature branch."
[ -z "$(git status --porcelain | grep -v '^??')" ] || fail "the working tree has uncommitted changes."

git fetch --quiet origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  BEHIND="$(git rev-list --count HEAD..origin/main)"
  fail "HEAD is not origin/main ($BEHIND commit(s) behind). A checkout one commit behind publishes a tarball missing the very thing you are publishing for, and it looks like a success. Run: git pull"
fi
echo "  clean, on main, at $(git rev-parse --short HEAD)"

# dist/ is generated and gitignored, so moving between branches leaves whatever
# the last build produced. It is rebuilt below, but the stale tree goes first so
# nothing can pass on old output.
rm -rf dist

# ---------------------------------------------------------------------------
# 2. Authenticate.
#
# A 404 from `npm publish` means AUTH far more often than a missing package —
# npm answers 404 rather than 403 so it cannot leak whether a name exists.
# `npm whoami` turns that confusing failure into a clear one, and is the only
# thing that reveals a token that is present but expired.
# ---------------------------------------------------------------------------
say "Checking npm authentication"
if ! NPM_USER="$(npm whoami 2>/dev/null)"; then
  echo "  not logged in — starting the browser login flow"
  npm login
  NPM_USER="$(npm whoami)"
fi
echo "  authenticated as $NPM_USER"

if npm view "$PACKAGE_NAME" version >/dev/null 2>&1; then
  npm owner ls "$PACKAGE_NAME" 2>/dev/null | grep -q "^$NPM_USER " \
    || fail "'$NPM_USER' is not an owner of $PACKAGE_NAME, so publishing will fail with a misleading 404."
  echo "  $NPM_USER is an owner of $PACKAGE_NAME"
else
  echo "  $PACKAGE_NAME does not exist yet — this is the first publish, which creates it"
fi

# ---------------------------------------------------------------------------
# 3. A version may be published at most once, ever.
# ---------------------------------------------------------------------------
VERSION="$(node -p "require('./package.json').version")"
say "Preparing $PACKAGE_NAME@$VERSION"

if npm view "$PACKAGE_NAME@$VERSION" version >/dev/null 2>&1; then
  fail "$PACKAGE_NAME@$VERSION is already published. A version can never be reused — bump it (npm run version:bump:patch), land that, then re-run."
fi

# ---------------------------------------------------------------------------
# 3b. Install exactly what the lockfile says, before anything reads node_modules.
#
# Every check above is about GIT. None of them looks at node_modules, and the
# two diverge exactly when a manifest change has just been pulled — which is
# precisely when someone is about to publish. A sibling package hit this: the
# checkout was clean, on main and current, and the build still failed on a
# dependency that had been renamed in a commit nobody had installed.
#
# `npm ci` rather than `npm install`, for two reasons: it installs exactly the
# lockfile, and it FAILS when the lockfile and manifest disagree. That
# disagreement is itself a reason not to publish — `npm install` would quietly
# reconcile it and ship a tarball built against a lockfile nobody committed.
# ---------------------------------------------------------------------------
say "Installing dependencies from the lockfile"
[ -f package-lock.json ] || fail "there is no package-lock.json, so there is nothing to install reproducibly from."
npm ci
echo "  node_modules now matches package-lock.json"

# ---------------------------------------------------------------------------
# 4. The gate, then the package check.
#
# Both, and in this order. The gate proves the SOURCE is good; verify:package
# proves what a CONSUMER receives is good — and for this package those are
# genuinely different claims, because the gate runs against TypeScript through
# ts-jest and a consumer runs the emitted JavaScript through Node.
# ---------------------------------------------------------------------------
say "Running the gate"
npm run gate

say "Verifying the package as a consumer receives it"
npm run verify:package

# ---------------------------------------------------------------------------
# 5. Read the tarball before trusting it.
# ---------------------------------------------------------------------------
say "Verifying the tarball"
PACK_OUTPUT="$(npm pack --dry-run 2>&1)"
FILE_COUNT="$(printf '%s' "$PACK_OUTPUT" | sed -n 's/.*total files:[[:space:]]*\([0-9]*\).*/\1/p' | tail -1)"

[ -n "$FILE_COUNT" ] || fail "could not read a file count from npm pack."
[ "$FILE_COUNT" -ge "$MIN_FILES" ] \
  || fail "the tarball has only $FILE_COUNT files (expected >= $MIN_FILES). Publishing this would ship a near-empty package on a version number that can never be reused."

for path in "${REQUIRED_PATHS[@]}"; do
  printf '%s' "$PACK_OUTPUT" | grep -q "$path" \
    || fail "'$path' is not in the tarball. The manifest points at it, so a consumer's install would be broken."
done

printf '%s' "$PACK_OUTPUT" | grep -q '__tests__' \
  && fail "the tarball contains test files. They import jest globals that are not dependencies of this package."

printf '%s' "$PACK_OUTPUT" | grep -qE '(^|/)src/' \
  && fail "the tarball contains src/. This package ships compiled dist/ only."

printf '%s' "$PACK_OUTPUT" | grep -q 'README.md' \
  || fail "no README.md in the tarball — npmjs.com would show 'This package does not have a README'."
printf '%s' "$PACK_OUTPUT" | grep -q 'LICENSE' \
  || fail "no LICENSE in the tarball. This package is Apache-2.0 and the licence text ships with it."
printf '%s' "$PACK_OUTPUT" | grep -q 'NOTICE' \
  || fail "no NOTICE in the tarball. Apache-2.0 requires it to travel with the licence."

# The bin is the whole product. A manifest pointing at a path the tarball does
# not contain installs cleanly and fails when a client tries to spawn it.
node -e '
  const fs = require("node:fs");
  const d = require("./package.json");
  const bins = typeof d.bin === "string" ? { [d.name]: d.bin } : (d.bin || {});
  const entries = Object.entries(bins);
  if (entries.length === 0) {
    console.error("REFUSING: package.json declares no bin, but this package IS a binary.");
    process.exit(1);
  }
  for (const [name, target] of entries) {
    if (!fs.existsSync(target)) {
      console.error(`REFUSING: bin "${name}" points at ${target}, which does not exist.`);
      process.exit(1);
    }
    if (!fs.readFileSync(target, "utf8").startsWith("#!")) {
      console.error(`REFUSING: bin "${name}" (${target}) has no shebang, so npm cannot execute it.`);
      process.exit(1);
    }
  }
'

echo "  $FILE_COUNT files; bin, entry points, README, LICENSE and NOTICE present; no tests; no src"

say "Tarball contents — read this before confirming"
printf '%s\n' "$PACK_OUTPUT" | sed -n 's/^npm notice[[:space:]]*[0-9.]*[kMG]*B*[[:space:]]*\(dist\/.*\)/  \1/p' | sort
echo "  ($FILE_COUNT files total)"

# ---------------------------------------------------------------------------
# 6. Publish. npm prompts for the OTP here.
# ---------------------------------------------------------------------------
say "Publishing $PACKAGE_NAME@$VERSION — npm will ask for your 2FA code"
npm publish --access public

# ---------------------------------------------------------------------------
# 7. PROVE IT. The registry is eventually consistent for a few seconds, so this
#    polls rather than asserting once, and ends with a real install AND a real
#    run — the same two claims verify:package makes, now against the registry.
# ---------------------------------------------------------------------------
say "Verifying it is actually installable"
PROBE_DIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_DIR"' EXIT

for attempt in $(seq 1 20); do
  if npm view "$PACKAGE_NAME@$VERSION" version >/dev/null 2>&1; then break; fi
  [ "$attempt" -lt 20 ] || fail "$PACKAGE_NAME@$VERSION is still not on the registry after publishing. The publish did NOT succeed, whatever it printed."
  sleep 3
done

printf '{"name":"probe","version":"1.0.0","private":true}' > "$PROBE_DIR/package.json"
(cd "$PROBE_DIR" && npm install --silent "$PACKAGE_NAME@$VERSION" >/dev/null 2>&1) \
  || fail "$PACKAGE_NAME@$VERSION resolves but cannot be installed."

INSTALLED="$(node -p "require('$PROBE_DIR/node_modules/$PACKAGE_NAME/package.json').version")"
[ "$INSTALLED" = "$VERSION" ] || fail "installed $INSTALLED but published $VERSION."

for path in "${REQUIRED_PATHS[@]}"; do
  [ -f "$PROBE_DIR/node_modules/$PACKAGE_NAME/$path" ] \
    || fail "$path is missing from the INSTALLED package, though it was in the tarball."
done

set +e
REGISTRY_OUTPUT="$("$PROBE_DIR/node_modules/.bin/stonedog-howto-mcp" 2>&1 </dev/null)"
set -e
printf '%s' "$REGISTRY_OUTPUT" | grep -qiE 'ERR_MODULE_NOT_FOUND|Cannot find (module|package)' \
  && fail "the PUBLISHED package cannot load its own modules. It is on the registry and it is broken; publish a fixed patch version."

printf '\n\033[32m✓ %s@%s is published, installable, and runs.\033[0m\n' "$PACKAGE_NAME" "$VERSION"
echo "  https://www.npmjs.com/package/$PACKAGE_NAME"
printf '\n\033[1mNext:\033[0m point a client at it with HOWTO_PORTAL_URL and HOWTO_API_TOKEN.\n'
printf '  The token decides what it can read, so issue it to a user with the\n'
printf '  narrowest access that still makes the archive useful.\n'
