#!/usr/bin/bash
#
# The credential, and the only place that touches it.
#
#     token.sh verify <url>    read a token on stdin, ask Shepherd whether it works
#     token.sh store <url>     read a token on stdin, put it in the login keyring
#     token.sh has <url>       exit 0 if a token is stored for this address
#     token.sh forget <url>    remove it
#
# The token arrives on stdin and leaves on stdin. It is never an argument to
# anything: argv is world-readable through /proc for every process this user
# runs, and a token that reaches a bar widget's process list has already left
# the keyring for good.
#
# The address is the account name, so consent and credential are filed under the
# same thing the operator typed. Pointing the plugin at a different Shepherd
# does not silently reuse the old token.
#
# Exit codes match bin/poll.sh, so both speak the vocabulary src/connection.js
# reads: 0 ok, 2 nothing stored, 3 refused, 4 wrong scope, 5 Shepherd's own
# first run is incomplete, 6 bad input, 7 unreachable, 64 usage.

set -uo pipefail
export LC_ALL=C

readonly ID="scoop.shepherd"
readonly CURL=/usr/bin/curl
readonly SECRET_TOOL=/usr/bin/secret-tool
readonly CONNECT_TIMEOUT=5
readonly MAX_TIME=15

usage() {
    echo "usage: token.sh <verify|store|has|forget> <url>" >&2
    exit 64
}

# A scheme, a host and an optional port. Nothing else — no path, query,
# fragment or credentials.
#
# Written as two alternatives rather than one character class because a POSIX
# bracket expression does not treat a backslash as an escape: "[...\[\]-]"
# closes at the first unescaped "]" and quietly stops matching anything real.
is_bare_origin() {
    [[ "$1" =~ ^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?$ ]] && return 0
    [[ "$1" =~ ^https?://\[[0-9A-Fa-f:]+\](:[0-9]{1,5})?$ ]] && return 0
    return 1
}

(($# == 2)) || usage
action="$1"
url="$2"

is_bare_origin "$url" || {
    echo "token: url is not a bare origin" >&2
    exit 6
}
[[ ${#url} -le 300 ]] || {
    echo "token: url too long" >&2
    exit 6
}

# Sets the global `token`, and reports failure through its status.
#
# Not `token="$(read_token)"`: a command substitution runs in a subshell, so an
# `exit` inside it ends the subshell and leaves the caller running — with an
# empty token and no indication that anything was rejected. A token this
# function refused would have gone on to be stored.
token=""
read_token() {
    local t=""
    # `read` reports failure at end of input even when it read a line, so what
    # it read is what is checked.
    IFS= read -r t || true
    if [[ -z "$t" ]]; then
        echo "token: nothing on stdin" >&2
        return 6
    fi
    # Shepherd's tokens are opaque; anything with whitespace or a shell
    # metacharacter in it is a paste accident, and storing it would produce a
    # 401 an hour later with no explanation.
    if [[ ! "$t" =~ ^[A-Za-z0-9._~+/=-]{8,512}$ ]]; then
        echo "token: that does not look like a Shepherd access token" >&2
        return 6
    fi
    token="$t"
    return 0
}

# Ask Shepherd whether this credential works, and whether it reaches far enough.
#
# /api/holds rather than /api/me: both are in the read scope, but only one of
# them is a route this plugin actually depends on, so a token that passes here
# is a token the bar will work with. A submit-scoped token answers /api/me and
# then 403s on every poll — better to find that out now.
verify() {
    local token="$1" combined status
    combined="$("$CURL" \
        --silent --show-error \
        --config <(printf 'header = "Authorization: Bearer %s"\n' "$token") \
        --connect-timeout "$CONNECT_TIMEOUT" \
        --max-time "$MAX_TIME" \
        --max-filesize 2000000 \
        --output /dev/null \
        --write-out '%{http_code}' \
        --url "${url}/api/holds" 2>/dev/null)" || return 7
    status="$combined"
    case "$status" in
        200) return 0 ;;
        401) return 3 ;;
        403) return 4 ;;
        409) return 5 ;;
        *) return 7 ;;
    esac
}

case "$action" in
    verify)
        read_token || exit $?
        verify "$token"
        exit $?
        ;;
    store)
        read_token || exit $?
        verify "$token" || exit $?
        printf '%s\n' "$token" | "$SECRET_TOOL" store \
            --label="Shepherd access token ($ID)" \
            service "$ID" account "$url" || {
            echo "token: could not write to the login keyring" >&2
            exit 6
        }
        exit 0
        ;;
    has)
        stored="$("$SECRET_TOOL" lookup service "$ID" account "$url" 2>/dev/null)" || true
        [[ -n "$stored" ]] || exit 2
        exit 0
        ;;
    forget)
        "$SECRET_TOOL" clear service "$ID" account "$url" 2>/dev/null || true
        exit 0
        ;;
    *)
        usage
        ;;
esac
