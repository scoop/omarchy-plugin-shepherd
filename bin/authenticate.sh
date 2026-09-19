#!/usr/bin/bash
#
# Set this plugin up from a terminal.
#
#     ~/.config/omarchy/plugins/scoop.shepherd/bin/authenticate.sh
#
# The bar widget is invisible until an address is configured, so there is no
# click target to start from on a fresh install — this is the way in. It is also
# the way back when the shell is not running, or when the token has been revoked
# and the widget is the thing that stopped working.
#
# It asks for two things, checks them against Shepherd before committing to
# either, puts the token in the login keyring and the address in shell.json
# through Omarchy's own bar commands. It writes nothing itself.

set -uo pipefail
export LC_ALL=C

readonly ID="scoop.shepherd"
readonly HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TOKEN_SH="$HERE/token.sh"

say() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }

say "Shepherd — Omarchy plugin setup"
say

# ── the address ───────────────────────────────────────────────────────────────

url="${1-}"
if [[ -z "$url" ]]; then
    say "The base URL of your Shepherd instance, with no path."
    say "For a Tailscale-served instance that is something like"
    say "  https://shepherd.your-tailnet.ts.net"
    say "and for one on this machine, http://127.0.0.1:7330"
    say
    read -r -p "Address: " url
fi
url="${url%/}"

# Two alternatives rather than one character class, for the same reason as in
# poll.sh and token.sh: a POSIX bracket expression does not treat a backslash
# as an escape, so "[...\[\]-]" closes at the first unescaped "]" and rejects
# every address anybody would actually type.
is_bare_origin() {
    [[ "$1" =~ ^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?$ ]] && return 0
    [[ "$1" =~ ^https?://\[[0-9A-Fa-f:]+\](:[0-9]{1,5})?$ ]] && return 0
    return 1
}

if ! is_bare_origin "$url"; then
    err "That is not a bare origin — scheme and host only, no path or query."
    exit 1
fi

scheme="${url%%://*}"
hostport="${url#*://}"
host="${hostport%%:*}"

if [[ "$scheme" == "http" ]] &&
    [[ ! "$host" =~ ^(localhost|127\.[0-9.]+|::1|\[::1\])$ ]]; then
    err "Refusing http:// to $host — the access token would cross the network in clear."
    err
    err "If that address really is safe to use unencrypted, grant consent for"
    err "exactly it and nothing else:"
    err
    err "  omarchy bar set $ID allowPlaintextFor '$url'"
    err
    err "Changing the address later withdraws that consent by itself."
    exit 1
fi

# ── the token ─────────────────────────────────────────────────────────────────

say
say "Shepherd needs an access token with the 'read' scope."
say "Mint one in Shepherd: Settings -> Access -> Create a token."
say "The plaintext is shown once, at creation."
say
say "A 'read' token can list sessions and holds and nothing else — it cannot"
say "spawn work, steer a terminal or merge anything. Do not paste a 'full' one."
say

# -s so it is not echoed; it is also not passed as an argument to anything.
read -r -s -p "Token: " token
say
say

say "Checking it against $url ..."

# One prompt, one call: token.sh store verifies the credential against the
# instance before it writes anything, so there is nothing to gain from asking
# twice and a second prompt is just a second chance to fat-finger it.
rc=0
printf '%s\n' "$token" | "$TOKEN_SH" store "$url" || rc=$?
token=""

case "$rc" in
    0) say "Accepted, and stored in the login keyring as '$ID' / '$url'." ;;
    2 | 3)
        err "Shepherd refused that token. If you revoked it, mint a new one."
        exit 1
        ;;
    4)
        err "That token does not carry the 'read' scope — Shepherd answered 403."
        err "Mint one with 'read' and try again."
        exit 1
        ;;
    5)
        err "Shepherd has not finished its own first-run setup yet."
        err "Open it in a browser, pick a repo root, then run this again."
        exit 1
        ;;
    6)
        err "That did not look like an access token, or the keyring refused it."
        exit 1
        ;;
    *)
        err "Could not reach $url."
        err "If it is served over Tailscale, check that you are on the tailnet."
        exit 1
        ;;
esac

# ── the bar entry ─────────────────────────────────────────────────────────────

say
if ! command -v omarchy >/dev/null 2>&1; then
    err "omarchy is not on PATH — add the widget by hand:"
    err "  omarchy bar put $ID right"
    err "  omarchy bar set $ID baseUrl '$url'"
    exit 0
fi

if omarchy bar set "$ID" baseUrl "$url" >/dev/null 2>&1; then
    say "Address written to shell.json."
else
    say "The widget is not on the bar yet. Adding it to the right-hand section."
    omarchy bar put "$ID" right >/dev/null 2>&1 || true
    if ! omarchy bar set "$ID" baseUrl "$url" >/dev/null 2>&1; then
        err "Could not write the address. Add it by hand:"
        err "  omarchy bar put $ID right"
        err "  omarchy bar set $ID baseUrl '$url'"
        exit 1
    fi
    say "Added, and the address written."
fi

say
say "Done. The bar stays empty until a session is waiting on you."
say "To remove the token later:  secret-tool clear service $ID account '$url'"
