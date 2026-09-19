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
# handed to curl on stdin as a header list — /proc/<pid>/cmdline is readable by
# every process this user runs, and so is /proc/<pid>/environ. The QML side
# never holds the token at all.
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
# Byte semantics for every length test below. Without it a multi-byte response
# can satisfy ${#s} while head has already read past the ceiling.
export LC_ALL=C

readonly ID="scoop.shepherd"
readonly CURL=/usr/bin/curl
readonly HEAD=/usr/bin/head
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

# The keyring is storage, not a promise about what is in it: an entry can be
# written by anything running as this user, and a carriage return or newline in
# the value would end the Authorization header and begin a second one of
# somebody else's choosing. Shepherd's tokens are opaque and narrow, so anything
# outside that shape is refused rather than sent.
[[ "$token" =~ ^[A-Za-z0-9._~+/=-]{8,512}$ ]] ||
    die "the stored token is not shaped like a Shepherd access token" 6

# Printed by a shell builtin straight into a pipe, so the token exists only in
# this process's memory and curl's.
#
# `-H @-` reads a header LIST. It used to be `--config -`, which is a different
# and worse thing: in a config file a quote or a newline inside the value is
# another directive, so a token containing one could add a second URL for curl
# to fetch — with the Authorization header attached.
auth_header() {
    printf 'Authorization: Bearer %s\n' "$token"
}

# One GET. Prints the body, a newline, and the three-digit HTTP status.
#
# The ceiling is applied by head as the bytes arrive rather than by measuring
# the result afterwards: --max-filesize acts on a declared Content-Length and
# does nothing about a chunked body, so by itself it is a guard that runs after
# the allocation it exists to prevent. The +4 covers curl's trailing newline and
# status, so a body within the limit still arrives whole and anything larger is
# caught by the length check in get().
#
# No -L: a redirect on a credentialed request is how a bearer token reaches a
# host nobody chose. -q first, so ~/.curlrc cannot add one. --noproxy, so the
# environment cannot route the request elsewhere.
fetch() {
    local path="$1" authed="$2"
    if [[ "$authed" == "yes" ]]; then
        auth_header | "$CURL" -q \
            --silent --show-error \
            --header @- \
            --proto '=http,https' \
            --noproxy '*' \
            --connect-timeout "$CONNECT_TIMEOUT" \
            --max-time "$MAX_TIME" \
            --max-filesize "$MAX_BYTES" \
            --write-out $'\n%{http_code}' \
            --url "${url}${path}" 2>/dev/null | "$HEAD" -c $((MAX_BYTES + 4))
    else
        "$CURL" -q \
            --silent --show-error \
            --proto '=http,https' \
            --noproxy '*' \
            --connect-timeout "$CONNECT_TIMEOUT" \
            --max-time "$MAX_TIME" \
            --max-filesize "$MAX_BYTES" \
            --write-out $'\n%{http_code}' \
            --url "${url}${path}" 2>/dev/null | "$HEAD" -c $((MAX_BYTES + 4))
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
        *) exit 7 ;;
    esac
}

# One request, with both ceilings enforced before anything is believed.
#
# The pipeline's exit status is deliberately not the decision. head closing the
# pipe on an oversized body kills curl with SIGPIPE, and a transport failure
# leaves no status to parse; both arrive here as a status that is not 200, which
# is the thing acted on.
get() {
    local combined
    combined="$(fetch "$1" "$2")" || true
    split "$combined"
    [[ "$status" == "200" ]] || fail_for_status "$status"
    [[ ${#body} -le $MAX_BYTES ]] || die "$1 answered with more than $MAX_BYTES bytes" 6
}

# Liveness first. It is unauthenticated, discloses nothing, and costs one round
# trip — and it is the difference between "you are off the tailnet" and "your
# token was revoked", which the operator must not have to guess at.
get /api/health no

# Sessions before holds, so that the gap between the two snapshots produces
# holds for sessions already gone — which are discarded — rather than sessions
# whose hold has not been fetched yet.
get /api/sessions yes
[[ "${body:0:1}" == "[" ]] || die "sessions did not answer with a list" 6
sessions="$body"

get /api/holds yes
[[ "${body:0:1}" == "{" ]] || die "holds did not answer with an object" 6

printf '%s\n%s\n%s\n%s\n' "--sessions--" "$sessions" "--holds--" "$body"
