#!/usr/bin/bash
#
# Validate what would actually ship, not the working tree.
#
# `omarchy plugin add` is a git clone, so what lands on someone else's machine
# is HEAD — not the dirty worktree, and not the files .gitignore keeps back.
# This exports HEAD and runs Omarchy's own validator over that copy, which is
# also the only way to catch a file that is present locally and untracked.

set -euo pipefail

readonly OUT=".validate"
readonly VALIDATOR=/usr/share/omarchy/bin/omarchy-plugin-validate

[[ -x "$VALIDATOR" ]] || {
    echo "validate: $VALIDATOR is not installed here" >&2
    exit 1
}

rm -rf "$OUT"
mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
"$VALIDATOR" "$OUT"
echo "validate: HEAD is a valid plugin"
