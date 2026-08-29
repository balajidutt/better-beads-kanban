#!/usr/bin/env bash
#
# Guarded wrapper around `bd dolt push` / `bd dolt pull` for this repo's backlog.
#
# Why this exists: under gastownhall/beads#5433, embedded Dolt can stop turning
# writes into commits. In that state `bd dolt push` prints "Push complete." and
# exits 0 while the remote ref never advances, so a silent failure looks exactly
# like a success. The reporter lost 103 issues to it. This script compares
# refs/dolt/data on the remote before and after, and turns that silence into a
# non-zero exit code.
#
# Usage:
#   scripts/bd-sync.sh            push the backlog, verify the ref advanced
#   scripts/bd-sync.sh --pull     pull the backlog, verify the local head moved
#   scripts/bd-sync.sh --flush    `bd dolt commit` first, then push
#
# Exit codes are distinct so that 1 keeps a single meaning:
#   0  pushed/pulled, or verified already up to date
#   1  STALL: the transfer was reported but the ref did not follow
#   2  UNVERIFIED: cannot prove either outcome (no baseline, concurrent writer)
#   3  precondition failed; nothing was pushed
#   4  bd itself exited non-zero
#
# Depends only on bd, git and node. Not dolt: it is mise-managed here and absent
# from a minimal PATH. `bd sql` would answer all of this with one query against
# dolt_status, but returns "not yet supported in embedded mode" as of bd 1.2.2 —
# retest after a bd upgrade and most of this script can collapse into that.

set -euo pipefail

ABSENT="__ABSENT__"
START_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

MODE=push
FLUSH=0
for arg in "$@"; do
  case "$arg" in
    --pull)  MODE=pull ;;
    --flush) FLUSH=1 ;;
    -h|--help)
      cat <<'EOF'
Guarded bd dolt push/pull. Verifies refs/dolt/data actually advanced.

  scripts/bd-sync.sh            push the backlog, verify the ref advanced
  scripts/bd-sync.sh --pull     pull the backlog, verify the local head moved
  scripts/bd-sync.sh --flush    `bd dolt commit` first, then push

Exit: 0 ok | 1 stall | 2 unverified | 3 precondition | 4 bd failed
EOF
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument '${arg}'. Usage: $0 [--pull] [--flush]" >&2
      exit 3
      ;;
  esac
done

if [ "$MODE" = pull ] && [ "$FLUSH" = 1 ]; then
  echo "ERROR: --flush applies to push only." >&2
  exit 3
fi

die() { local code=$1; shift; echo "ERROR: $*" >&2; exit "$code"; }

for tool in git node; do
  command -v "$tool" >/dev/null 2>&1 || die 3 "${tool} is required."
done
command -v bd >/dev/null 2>&1 || die 3 "bd is required."

# --- Locate the backlog ------------------------------------------------------
#
# --git-common-dir resolves to the main checkout's .git from a linked worktree.
# A worktree has no .beads of its own, and running bd there tempts `bd init`,
# which forks the backlog into a second database that syncs nowhere.
GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
  || die 3 "not inside a git repository."
BD_REPO=$(dirname "$GIT_COMMON")
BEADS_DIR="${BD_REPO}/.beads"
[ -d "$BEADS_DIR" ] || die 3 "no .beads directory under ${BD_REPO}."

bd_json() {
  local out
  out=$(command bd -C "$BD_REPO" "$@" --json 2>&1) || {
    printf '%s\n' "$out" >&2
    return 1
  }
  printf '%s' "$out"
}

# A missing or non-string field exits 9 rather than printing empty. Empty would
# compare equal to empty on the next line and read as "nothing changed" — a
# false pass in the one guard that must never produce one.
json_field() {
  node -e '
    const o = JSON.parse(process.argv[1]);
    const v = o[process.argv[2]];
    if (typeof v !== "string" || v === "") process.exit(9);
    process.stdout.write(v);
  ' "$1" "$2" 2>/dev/null
}

# Dolt commit hashes are 32 characters of base32 over [0-9a-v].
valid_dolt_hash() { [[ "$1" =~ ^[0-9a-v]{32}$ ]]; }

# Issue count plus the newest updated_at, as bd sees them. Under #5433 the
# writes are visible to `bd list` but never become Dolt commits, so the head
# does not move and neither ref does — the push is a legitimate no-op and no
# amount of ref-watching can see the problem. Data that moved while the head
# stood still is the only signal that separates that from having nothing to
# send. Creates and deletes change the count; edits and closes advance the
# timestamp.
content_fingerprint() {
  command bd -C "$BD_REPO" list --status=all --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const parsed = JSON.parse(s);
        const rows = Array.isArray(parsed) ? parsed : (parsed.issues || []);
        const newest = rows.map(r => r.updated_at || "").sort().pop() || "";
        process.stdout.write(rows.length + ":" + newest);
      } catch (e) { process.exit(9); }
    });
  ' 2>/dev/null
}

local_head() {
  local raw head
  raw=$(bd_json vc status) || die 4 "bd vc status failed."
  head=$(json_field "$raw" commit) \
    || die 3 "bd vc status --json has no 'commit' field; bd output shape changed."
  valid_dolt_hash "$head" \
    || die 3 "bd reported '${head}', which is not a Dolt commit hash."
  printf '%s' "$head"
}

# --- Context -----------------------------------------------------------------

CTX=$(bd_json context) || die 3 "bd context failed."

# The Dolt remote is configured independently of the git remote and has drifted
# to a different owner before. Taking the URL from bd, rather than assuming a
# remote named "origin", is what keeps this script watching the same place bd
# pushes to.
DOLT_URL=$(json_field "$CTX" sync_remote) \
  || die 3 "no sync remote configured; see 'bd dolt remote list'."
DB_NAME=$(json_field "$CTX" database)      || die 3 "bd context has no database."
PROJECT_ID=$(json_field "$CTX" project_id) || die 3 "bd context has no project id."

# Dolt records the remote with a git+ prefix; git itself does not want it.
DOLT_URL="${DOLT_URL#git+}"

VC_RAW=$(bd_json vc status) || die 4 "bd vc status failed."
BRANCH=$(json_field "$VC_RAW" branch) || BRANCH=main

# --- Lock --------------------------------------------------------------------
#
# The extension spawns bd per operation and watches the noms files a push
# churns, so two syncs at once can contend for the Dolt lock. mkdir is the
# atomic primitive available everywhere; macOS has no flock(1).
LOCK_DIR="${BEADS_DIR}/.bd-sync.lock"
mkdir "$LOCK_DIR" 2>/dev/null \
  || die 3 "another bd-sync is running. If not, remove ${LOCK_DIR}"
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# --- Remote snapshots --------------------------------------------------------
#
# One round trip captures both refs, so they are observed atomically relative to
# each other. A missing ref yields the sentinel; git exits 0 with no output for
# a ref that does not exist, which would otherwise be indistinguishable from a
# failed capture.
SNAP_DATA=""
SNAP_INFO=""
snapshot() {
  local out
  if ! out=$(GIT_TERMINAL_PROMPT=0 git ls-remote "$DOLT_URL" 2>&1); then
    printf '%s\n' "$out" >&2
    return 1
  fi
  SNAP_DATA=$(awk -v w=refs/dolt/data -v a="$ABSENT" \
    '$2==w{print $1; f=1} END{if(!f) print a}' <<<"$out")
  SNAP_INFO=$(awk -v w=refs/heads/__dolt_remote_info__ -v a="$ABSENT" \
    '$2==w{print $1; f=1} END{if(!f) print a}' <<<"$out")
}

# --- State file --------------------------------------------------------------
#
# Records the local head at the last transfer this script could prove. It is the
# only way to tell "nothing to push" from a stall, because a Dolt commit hash
# and the git SHA of refs/dolt/data are different namespaces and cannot be
# compared directly.
#
# Named clear of push-state.json, sync-state.json and last_pull, which
# .beads/.gitignore already reserves for bd's own runtime files.
STATE_FILE="${BEADS_DIR}/.bd-sync-state.json"
STATE_HEAD=""
STATE_REMOTE=""
STATE_FP=""

read_state() {
  [ -f "$STATE_FILE" ] || return 0
  local raw
  raw=$(cat "$STATE_FILE" 2>/dev/null) || return 0
  local pid db br
  pid=$(json_field "$raw" project_id) || return 0
  db=$(json_field "$raw" database)    || return 0
  br=$(json_field "$raw" branch)      || return 0
  # A rebuilt or re-cloned database makes the recorded hash meaningless.
  [ "$pid" = "$PROJECT_ID" ] && [ "$db" = "$DB_NAME" ] && [ "$br" = "$BRANCH" ] || return 0
  STATE_HEAD=$(json_field "$raw" head) || STATE_HEAD=""
  STATE_REMOTE=$(json_field "$raw" remote_data) || STATE_REMOTE=""
  STATE_FP=$(json_field "$raw" fingerprint) || STATE_FP=""
}

write_state() {
  local head=$1 remote=$2 via=$3 fp=$4
  node -e '
    const [head, remote, via, fp, pid, db, br, at, out] = process.argv.slice(1);
    require("fs").writeFileSync(out,
      JSON.stringify({ head, remote_data: remote, via, fingerprint: fp,
                       project_id: pid, database: db, branch: br, at }, null, 2) + "\n");
  ' "$head" "$remote" "$via" "$fp" "$PROJECT_ID" "$DB_NAME" "$BRANCH" "$START_TS" "$STATE_FILE"
}

# --- Attribution -------------------------------------------------------------
#
# refs/heads/__dolt_remote_info__ is a one-commit branch Dolt maintains on the
# remote; its only file records the head that refs/dolt/data should be at and
# when it was written. That timestamp is what distinguishes an advance caused by
# this run from one the other machine made a minute ago.
#
# This is undocumented Dolt internals, so every failure here degrades to UNKNOWN
# rather than aborting: a Dolt version bump should cost a diagnostic, not the
# script.
INFO_HEAD=""
INFO_TS=""
read_info_branch() {
  [ "$SNAP_INFO" = "$ABSENT" ] && return 1
  local md
  GIT_TERMINAL_PROMPT=0 git -C "$BD_REPO" fetch --quiet --no-tags --depth=1 \
    "$DOLT_URL" refs/heads/__dolt_remote_info__ 2>/dev/null || return 1
  md=$(git -C "$BD_REPO" show FETCH_HEAD:DOLT_REMOTE.md 2>/dev/null) || return 1
  INFO_HEAD=$(awk -F= '$1=="head"{print $2; exit}' <<<"$md")
  INFO_TS=$(awk -F= '$1=="timestamp"{print $2; exit}' <<<"$md")
  [ -n "$INFO_HEAD" ] && [ -n "$INFO_TS" ]
}

diagnostics() {
  cat >&2 <<EOF

--- bd-sync diagnostics ---
  dolt remote : ${DOLT_URL}
  database    : ${DB_NAME} (branch ${BRANCH})
  refs/dolt/data       ${BEFORE_DATA}  ->  ${AFTER_DATA}
  __dolt_remote_info__ ${BEFORE_INFO}  ->  ${AFTER_INFO}
  local head  : start ${HEAD_START}
                pre   ${HEAD_PRE}
                post  ${HEAD_POST}
  info branch : head=${INFO_HEAD:-<unread>} timestamp=${INFO_TS:-<unread>}
  state file  : ${STATE_FILE}
                head=${STATE_HEAD:-<none>} remote_data=${STATE_REMOTE:-<none>}
  issues      : then ${STATE_FP:-<none>}  now ${FP_NOW:-<unread>}

Take over by hand with:
  git ls-remote ${DOLT_URL} refs/dolt/data
  command bd -C ${BD_REPO} dolt commit
  command bd -C ${BD_REPO} dolt push
  git ls-remote ${DOLT_URL} refs/dolt/data
EOF
}

# --- Run ---------------------------------------------------------------------

read_state

snapshot || die 3 "cannot reach the Dolt remote; refusing to ${MODE} unverified."
BEFORE_DATA=$SNAP_DATA
BEFORE_INFO=$SNAP_INFO

HEAD_START=$(local_head)
HEAD_PRE=$HEAD_START
FP_NOW=$(content_fingerprint) || FP_NOW=""

if [ "$FLUSH" = 1 ]; then
  echo "==> bd dolt commit (--flush)"
  # "Nothing to commit." is also what bd says in the broken state this script
  # exists to catch, so the answer is reported, never trusted.
  FLUSH_OUT=$(command bd -C "$BD_REPO" dolt commit 2>&1) || die 4 "bd dolt commit failed: ${FLUSH_OUT}"
  echo "    bd said: \"$(head -n1 <<<"$FLUSH_OUT")\" (not evidence)"
  HEAD_PRE=$(local_head)
fi

echo "==> bd dolt ${MODE}"
BD_RC=0
BD_OUT=$(command bd -C "$BD_REPO" dolt "$MODE" 2>&1) || BD_RC=$?
echo "    bd said: \"$(head -n1 <<<"$BD_OUT")\" (not evidence)"

snapshot || die 3 "${MODE} ran but the remote is now unreachable; state unknown."
AFTER_DATA=$SNAP_DATA
AFTER_INFO=$SNAP_INFO
HEAD_POST=$(local_head)

if [ "$BD_RC" -ne 0 ]; then
  echo "$BD_OUT" >&2
  diagnostics
  die 4 "bd dolt ${MODE} exited ${BD_RC}."
fi

# --- Verdict -----------------------------------------------------------------

if [ "$MODE" = pull ]; then
  if [ "$HEAD_POST" != "$HEAD_START" ]; then
    # The local head came from the remote, so it is provably on the remote.
    # The pull changed the data, so the pre-pull fingerprint is already stale.
    FP_POST=$(content_fingerprint) || FP_POST=""
    write_state "$HEAD_POST" "$AFTER_DATA" pull "$FP_POST"
    echo "PULLED: local head ${HEAD_START:0:8} -> ${HEAD_POST:0:8}"
    exit 0
  fi
  if [ -n "$STATE_REMOTE" ] && [ "$STATE_REMOTE" = "$AFTER_DATA" ]; then
    echo "UP TO DATE: local head ${HEAD_POST:0:8} already matches the remote."
    exit 0
  fi
  diagnostics
  echo "UNVERIFIED: pull moved nothing and there is no baseline to compare against." >&2
  echo "  Run a push first to establish one, or check the remote by hand." >&2
  exit 2
fi

if [ "$HEAD_POST" != "$HEAD_PRE" ]; then
  diagnostics
  echo "UNVERIFIED: the local head moved during the push — another writer is active." >&2
  echo "  Close the Kanban board or wait for the other agent, then re-run." >&2
  exit 2
fi

if [ "$AFTER_DATA" != "$BEFORE_DATA" ]; then
  ATTRIBUTED=unknown
  if read_info_branch; then
    if [ "$INFO_HEAD" = "$AFTER_DATA" ] && [[ "$INFO_TS" > "$START_TS" || "$INFO_TS" == "$START_TS" ]]; then
      ATTRIBUTED=yes
    else
      ATTRIBUTED=no
    fi
  fi

  case "$ATTRIBUTED" in
    yes|unknown)
      # State is written only here. "The ref moved, therefore I pushed" is the
      # tempting shortcut and it is a false pass: the other machine or the
      # extension may have moved it, after which the next run would report "up
      # to date" over an unpushed local head.
      write_state "$HEAD_POST" "$AFTER_DATA" push "$FP_NOW"
      echo "PUSHED: refs/dolt/data ${BEFORE_DATA:0:8} -> ${AFTER_DATA:0:8}"
      if [ "$ATTRIBUTED" = unknown ]; then
        echo "  (could not read the info branch; advance assumed to be yours)"
      fi
      exit 0
      ;;
    no)
      diagnostics
      echo "UNVERIFIED: the remote advanced, but not because of this push." >&2
      echo "  Another machine pushed. Run 'scripts/bd-sync.sh --pull', then re-run." >&2
      exit 2
      ;;
  esac
fi

if [ "$BEFORE_DATA" = "$ABSENT" ]; then
  diagnostics
  echo "STALL: first push to this remote created no refs/dolt/data." >&2
  exit 1
fi

if [ "$HEAD_PRE" != "$HEAD_START" ]; then
  diagnostics
  echo "STALL: --flush created commit ${HEAD_PRE:0:8} and the remote never advanced." >&2
  echo "  This is the signature of gastownhall/beads#5433." >&2
  exit 1
fi

if [ "$AFTER_INFO" != "$BEFORE_INFO" ]; then
  diagnostics
  echo "STALL: the push reached the remote but refs/dolt/data did not move." >&2
  exit 1
fi

if [ -n "$STATE_HEAD" ] && [ "$STATE_HEAD" = "$HEAD_POST" ] && [ "$STATE_REMOTE" = "$AFTER_DATA" ]; then
  if [ -n "$FP_NOW" ] && [ -n "$STATE_FP" ] && [ "$FP_NOW" != "$STATE_FP" ]; then
    diagnostics
    echo "STALL: the issue data changed since your last verified push, but the" >&2
    echo "  Dolt head never moved (${HEAD_POST:0:8}), so there was nothing to send." >&2
    echo "  Writes are stuck in the working set — gastownhall/beads#5433." >&2
    echo "  issues then: ${STATE_FP}" >&2
    echo "  issues now:  ${FP_NOW}" >&2
    echo "  Try 'scripts/bd-sync.sh --flush'. If that reports \"Nothing to commit.\"" >&2
    echo "  the database needs a human before any more work goes into it." >&2
    exit 1
  fi
  echo "UP TO DATE: ${HEAD_POST:0:8} was already pushed; nothing to send."
  exit 0
fi

if [ -n "$STATE_REMOTE" ] && [ "$STATE_REMOTE" != "$AFTER_DATA" ]; then
  diagnostics
  echo "UNVERIFIED: the remote moved since your last verified push." >&2
  echo "  Run 'scripts/bd-sync.sh --pull', then re-run." >&2
  exit 2
fi

diagnostics
echo "UNVERIFIED: no baseline yet, so an unchanged ref cannot be read either way." >&2
echo "  Make a change and re-run to establish one." >&2
exit 2
