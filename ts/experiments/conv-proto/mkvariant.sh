#!/bin/sh
# Makes one variant: a copy of ts/src without test data and test files, at <variants dir>/<name>/src.
# The variant is then edited by hand (or by a patch script) outside the repository; ts/src is never changed.
# Usage: sh mkvariant.sh <variants dir> <name> [source variant name]
# With a third argument the copy is made from that variant instead of ts/src (to stack changes).
set -e
VARS="${1:?variants dir}"
NAME="${2:?name}"
FROM="${3:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -n "$FROM" ]; then
  SRC="$VARS/$FROM/src"
else
  SRC="$HERE/../../src"
fi
DEST="$VARS/$NAME/src"
if [ -e "$DEST" ]; then
  echo "exists: $DEST" >&2
  exit 1
fi
mkdir -p "$DEST"
# tar keeps the tree in one process (a cp per file is slow on Windows)
(cd "$SRC" && tar cf - --exclude=testdata --exclude='*.test.ts' .) | (cd "$DEST" && tar xf -)
echo "$DEST"
