#!/usr/bin/bash
#
# Read at most a fixed number of bytes from one file, without following a
# symlink and without blocking on a FIFO.
#
#     read-bounded.sh <max-bytes> </absolute/path>
#
# `cat` was here first, and it is wrong for a file the shell did not just
# create. It follows a symlink, so anything running as this user can point the
# name at a file of its choosing; it blocks forever on a FIFO planted at the
# same name, and the thing it blocks is the one process on the desktop that
# should not be stoppable by a file; and it reads the whole thing before any
# length check can run. dd with iflag=nofollow,nonblock refuses the first two at
# the open, and count_bytes bounds the read at the producer.
#
# It emits max+1 bytes deliberately: the caller sets its own ceiling at max, so
# an overflow is detected rather than silently truncated into something that
# parses.
#
#    0  bytes follow
#    1  could not open the file as a regular, non-symlink file
#   64  usage error

set -uo pipefail
export LC_ALL=C

readonly DD=/usr/bin/dd

usage() {
    echo "usage: read-bounded.sh <max-bytes> </absolute/path>" >&2
    exit 64
}

(($# == 2)) || usage
max="$1"
file="$2"

[[ "$max" =~ ^[0-9]{1,9}$ ]] && ((max > 0)) || usage
# Absolute, because this is the one door the file comes through and PATH-style
# resolution of a data path is somebody else's decision about which file it is.
[[ "$file" == /* ]] || usage
[[ "$file" != *$'\n'* ]] || usage

"$DD" if="$file" \
    iflag=nofollow,nonblock,count_bytes,fullblock \
    bs=65536 count=$((max + 1)) status=none 2>/dev/null || exit 1
