#!/bin/sh
set -eu
exec node "$(dirname "$0")/beads-session-prime.js"
