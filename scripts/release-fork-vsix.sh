#!/usr/bin/env bash

set -euo pipefail

DRY_RUN=0
RELEASE_ISSUE=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-issue)
      if [ -n "$RELEASE_ISSUE" ] || [ "$#" -lt 2 ] || [[ "$2" == -* ]] || [ -z "$2" ]; then
        echo "ERROR: supply --release-issue exactly once with its issue ID." >&2
        exit 1
      fi
      RELEASE_ISSUE=$2
      shift 2
      ;;
    --dry-run)
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "ERROR: duplicate --dry-run." >&2
        exit 1
      fi
      DRY_RUN=1
      shift
      ;;
    --help)
      if [ "$#" -ne 1 ] || [ -n "$RELEASE_ISSUE" ] || [ "$DRY_RUN" -ne 0 ]; then exit 1; fi
      echo "Usage: release-fork-vsix.sh --release-issue ID [--dry-run]"
      exit 0
      ;;
    *) echo "ERROR: unknown release argument." >&2; exit 1 ;;
  esac
done
if [ -z "$RELEASE_ISSUE" ]; then
  echo "ERROR: --release-issue is required." >&2
  exit 1
fi

TOOL_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
TOOL_ROOT=$(dirname "$TOOL_DIR")
for variable in ${!GIT_@}; do unset "$variable"; done
export GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0

FORK_REPO="balajidutt/better-beads-kanban"
export GH_HOST=github.com

if [ ! -x "$TOOL_ROOT/node_modules/.bin/vsce" ]; then
  echo "ERROR: prepare the reviewed tooling checkout's locked VSCE dependency." >&2
  exit 1
fi
if [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: token overrides are unsupported for account-restoring releases." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh is required to create the release." >&2
  exit 1
fi

EXPECTED_OWNER="${FORK_REPO%%/*}"
PREV_GH_ACCOUNT=$(gh api user --jq .login 2>/dev/null || true)
if [ -z "$PREV_GH_ACCOUNT" ]; then
  echo "ERROR: cannot identify the active GitHub account." >&2
  exit 1
fi

restore_gh_account() {
  local status=$?
  trap - EXIT
  if [ -n "${PREV_GH_ACCOUNT:-}" ] && [ "$PREV_GH_ACCOUNT" != "$EXPECTED_OWNER" ]; then
    if ! gh auth switch --hostname github.com --user "$PREV_GH_ACCOUNT" >/dev/null 2>&1; then
      echo "ERROR: GitHub account restoration failed." >&2
      if [ "$status" -eq 0 ]; then status=1; fi
    elif [ "$(gh api user --jq .login 2>/dev/null || true)" != "$PREV_GH_ACCOUNT" ]; then
      echo "ERROR: GitHub account restoration could not be verified." >&2
      if [ "$status" -eq 0 ]; then status=1; fi
    fi
  fi
  exit "$status"
}
trap restore_gh_account EXIT

if [ "${PREV_GH_ACCOUNT:-}" != "$EXPECTED_OWNER" ] \
   && ! gh auth switch --hostname github.com --user "$EXPECTED_OWNER" >/dev/null 2>&1; then
  echo "ERROR: gh has no '${EXPECTED_OWNER}' account to switch to." >&2
  echo "  Run: gh auth login --hostname github.com --git-protocol ssh --scopes repo" >&2
  exit 1
fi

if [ "$(gh api user --jq .login 2>/dev/null || true)" != "$EXPECTED_OWNER" ]; then
  echo "ERROR: gh identity is not '${EXPECTED_OWNER}'; refusing to create a release." >&2
  exit 1
fi

BBK_RELEASE_SNAPSHOT=$(node "$TOOL_DIR/release-preflight.js" --release-issue "$RELEASE_ISSUE")
export BBK_RELEASE_SNAPSHOT
FULL_SHA=$(node -p 'JSON.parse(process.env.BBK_RELEASE_SNAPSHOT).sourceSha')
ORIG_NAME=$(node -p 'JSON.parse(process.env.BBK_RELEASE_SNAPSHOT).displayName')
PACKAGE_NAME=$(node -p 'JSON.parse(process.env.BBK_RELEASE_SNAPSHOT).name')
VERSION=$(node -p 'JSON.parse(process.env.BBK_RELEASE_SNAPSHOT).version')

# Same shape as SEMVER_RE in scripts/bump-version.js — keep the two in sync.
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-bd\.[0-9]+)?$ ]]; then
  echo "ERROR: version '${VERSION}' is not X.Y.Z or X.Y.Z-bd.N." >&2
  echo "  Run: node scripts/bump-version.js X.Y.Z" >&2
  exit 1
fi

TAG="v${VERSION}"
TARGET_VSIX="${PACKAGE_NAME}-${VERSION}.vsix"
RELEASE_TITLE="${ORIG_NAME} ${VERSION}"

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    echo "ERROR: neither shasum nor sha256sum is available." >&2
    return 1
  fi
}

echo "==> Verifying (tsc --noEmit, eslint, tests)"
npm run verify

if [ -e "$TARGET_VSIX" ] || [ -L "$TARGET_VSIX" ] || [ -e SHA256SUMS ] || [ -L SHA256SUMS ]; then
  echo "ERROR: release output collision; no files removed." >&2
  exit 1
fi

echo "==> Packaging ${TARGET_VSIX}"
"$TOOL_ROOT/node_modules/.bin/vsce" package --out "${TARGET_VSIX}"

(set -C; sha256_file "${TARGET_VSIX}" > SHA256SUMS)
EXPECTED_SHA=$(cut -d ' ' -f 1 < SHA256SUMS)

node "$TOOL_DIR/release-preflight.js" --release-issue "$RELEASE_ISSUE" --expected-snapshot "$BBK_RELEASE_SNAPSHOT" >/dev/null

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "==> Dry run: skipping 'gh release create'."
  echo "    Would create tag ${TAG} on ${FORK_REPO}."
else
  echo "==> Creating release ${TAG} on ${FORK_REPO}"
  gh release create "${TAG}" \
    --repo "${FORK_REPO}" \
    --target "${FULL_SHA}" \
    --latest \
    --title "${RELEASE_TITLE}" \
    --notes "Fork build of ${PACKAGE_NAME} ${VERSION} from ${FULL_SHA}. See CHANGELOG.md for what changed." \
    "${TARGET_VSIX}" SHA256SUMS
fi

cat <<EOF

Pin values for downstream installers:

  TAG="${TAG}"
  ASSET="${TARGET_VSIX}"
  EXPECTED_SHA="${EXPECTED_SHA}"
  VERSION="${VERSION}"

The same checksum is published as the release's SHA256SUMS asset, so an
automated pin can pick it up without downloading the VSIX.
EOF

rm -f "${TARGET_VSIX}" SHA256SUMS
