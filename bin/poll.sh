#!/usr/bin/bash
#
# One poll of a Shepherd instance: are you there, what sessions are there, and
# which of them are held.
#
# Reads one line of JSON on stdin:
#
#     {"url":"https://shepherd.example.ts.net","account":"<same url>"}
#
# and writes, on success, two bodies separated by marker lines:
#
#     --sessions--
#     [ ... ]
#     --holds--
#     { ... }
#
# The bearer token is never an argument and never an environment variable. It is
# looked up from the login keyring here, inside the process that uses it, and
# handed to curl on stdin through a config file descriptor — /proc/<pid>/cmdline
# is readable by every process this user runs, and so is /proc/<pid>/environ.
# The QML side never holds the token at all.
#
# What went wrong is reported through the exit status rather than through the
# output, so that an empty answer and a refusal can never be confused:
#
#     0  both bodies follow
#     2  no token stored for this address
#     3  Shepherd refused the credential (401)
#     4  the credential lacks the scope this needs (403)
#     5  Shepherd has not finished its own first-run setup (409)
#     6  the input, or something Shepherd said, was not what it should be
#     7  could not reach Shepherd at all
#    64  usage error
#   124  the deadline fired (supervise.sh)
#
# Shepherd checks the Origin header on some paths and this sends none, which is
# what a non-browser client is expected to do.

set -uo pipefail
export LC_ALL=C

readonly ID="scoop.shepherd"
readonly CURL=/usr/bin/curl
readonly SECRET_TOOL=/usr/bin/secret-tool

# Per request. Shepherd is usually a tailnet hop away, not a WAN round trip.
readonly CONNECT_TIMEOUT=5
readonly MAX_TIME=15

# A session list from a busy herd is tens of kilobytes. Two megabytes is far
# past anything legitimate and still small enough to hold in a variable.
readonly MAX_BYTES=2000000

die() {
    echo "poll: $1" >&2
    exit "$2"
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

# `read` reports failure at end of input even when it read a full line, so the
# variable is what is checked, not the status: a caller that does not end its
# line with a newline is still a caller that said something.
config=""
read -r config || true
[[ -n "$config" ]] || die "no configuration on stdin" 64
[[ ${#config} -le 1024 ]] || die "configuration too large" 64

# Pulled out with a narrow pattern rather than a JSON parser: this runs before
# anything is trusted, jq is one more dependency, and the only two values wanted
# are a URL that has already been validated in src/connection.js and the account
# it is filed under.
url="$(expr "$config" : '.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)"' || true)"
account="$(expr "$config" : '.*"account"[[:space:]]*:[[:space:]]*"\([^"]*\)"' || true)"
[[ -n "$url" ]] || die "no url" 64
[[ -n "$account" ]] || die "no account" 64

# Checked again here, because this is the process that attaches the credential.
# The QML side validates the same shape for its own reasons; neither check is
# the other's excuse.
is_bare_origin "$url" || die "url is not a bare origin" 6
[[ ${#url} -le 300 ]] || die "url too long" 6

token="$("$SECRET_TOOL" lookup service "$ID" account "$account" 2>/dev/null)" || true
[[ -n "$token" ]] || exit 2

# curl reads the header from here, so the token is never in argv. The fd is
# closed for every later call by being redirected per invocation.
auth_config() {
    printf 'header = "Authorization: Bearer %s"\n' "$token"
}

# Perform one GET. Prints the body on stdout and the HTTP status on fd 3's
# stand-in — here, as the last line, which the caller peels off.
fetch() {
    local path="$1" authed="$2"
    if [[ "$authed" == "yes" ]]; then
        auth_config | "$CURL" \
            --silent --show-error \
            --config - \
            --connect-timeout "$CONNECT_TIMEOUT" \
            --max-time "$MAX_TIME" \
            --max-filesize "$MAX_BYTES" \
            --write-out $'\n%{http_code}' \
            --url "${url}${path}" 2>/dev/null
    else
        "$CURL" \
            --silent --show-error \
            --connect-timeout "$CONNECT_TIMEOUT" \
            --max-time "$MAX_TIME" \
            --max-filesize "$MAX_BYTES" \
            --write-out $'\n%{http_code}' \
            --url "${url}${path}" 2>/dev/null
    fi
}

# Split "body\nSTATUS" into the two globals below.
body=""
status=""
split() {
    local combined="$1"
    status="${combined##*$'\n'}"
    body="${combined%$'\n'*}"
    [[ "$status" =~ ^[0-9]{3}$ ]] || status="000"
}

# Classify a status that is not 200, in the vocabulary src/connection.js reads.
fail_for_status() {
    case "$1" in
        401) exit 3 ;;
        403) exit 4 ;;
        409) exit 5 ;;
        000) exit 7 ;;
        *) exit 7 ;;
    esac
}

# Liveness first. It is unauthenticated, discloses nothing, and costs one round
# trip — and it is the difference between "you are off the tailnet" and "your
# token was revoked", which the operator must not have to guess at.
combined="$(fetch /api/health no)" || exit 7
split "$combined"
[[ "$status" == "200" ]] || fail_for_status "$status"

# Sessions before holds, so that the gap between the two snapshots produces
# holds for sessions already gone — which are discarded — rather than sessions
# whose hold has not been fetched yet.
combined="$(fetch /api/sessions yes)" || exit 7
split "$combined"
[[ "$status" == "200" ]] || fail_for_status "$status"
[[ ${#body} -le $MAX_BYTES ]] || die "sessions body too large" 6
[[ "${body:0:1}" == "[" ]] || die "sessions did not answer with a list" 6
sessions="$body"

combined="$(fetch /api/holds yes)" || exit 7
split "$combined"
[[ "$status" == "200" ]] || fail_for_status "$status"
[[ ${#body} -le $MAX_BYTES ]] || die "holds body too large" 6
[[ "${body:0:1}" == "{" ]] || die "holds did not answer with an object" 6

printf '%s\n%s\n%s\n%s\n' "--sessions--" "$sessions" "--holds--" "$body"
