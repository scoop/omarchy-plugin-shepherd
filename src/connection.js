// Where Shepherd is, whether we may talk to it, and what our view of it is.
//
// Loaded unchanged by both QML and bun; no imports.

/**
 * Hosts that never leave the machine. Shepherd binds 127.0.0.1 by default, so
 * an unencrypted request to one of these is a request that crosses nothing, and
 * demanding consent for it would train the operator to grant consent.
 *
 * @param {string} host
 */
function isLoopback(host) {
    var h = String(host || "").toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") {
        return true;
    }
    // The whole 127.0.0.0/8 block, not just .0.1.
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Parse and normalise a base URL without a URL parser.
 *
 * QML's JavaScript engine has no URL constructor, and this has to give the same
 * answer in both runtimes, so it is done by hand and deliberately narrowly: a
 * scheme this plugin accepts, a host, an optional port, and no path, query,
 * fragment or credentials. Anything else is refused rather than interpreted —
 * the value ends up in an argv that fetches with a bearer token attached, and
 * "refused" is a much easier thing to be sure of than "sanitised".
 *
 * @param {string} raw
 * @returns {import("./types").ParsedUrl}
 */
function parseBaseUrl(raw) {
    var value = String(raw || "").trim();
    if (value === "") {
        return { ok: false, reason: "empty", url: "", scheme: "", host: "", plaintext: false };
    }
    if (value.length > 300) {
        return { ok: false, reason: "too-long", url: "", scheme: "", host: "", plaintext: false };
    }
    var m = /^(https?):\/\/([^/?#\s@]+)\/*$/i.exec(value);
    if (!m) {
        return { ok: false, reason: "malformed", url: "", scheme: "", host: "", plaintext: false };
    }
    var scheme = m[1].toLowerCase();
    var authority = m[2];
    // Split off a port, allowing for a bracketed IPv6 literal.
    var host = authority;
    var bracket = authority.lastIndexOf("]");
    var colon = authority.lastIndexOf(":");
    if (colon > bracket) {
        // The port is validated and then discarded: the normalised URL keeps
        // the authority verbatim, so there is nothing to carry forward.
        var portPart = authority.slice(colon + 1);
        host = authority.slice(0, colon);
        if (!/^\d{1,5}$/.test(portPart) || Number(portPart) < 1 || Number(portPart) > 65535) {
            return {
                ok: false,
                reason: "malformed",
                url: "",
                scheme: "",
                host: "",
                plaintext: false,
            };
        }
    }
    if (host === "" || !/^[A-Za-z0-9._\-[\]:]+$/.test(host)) {
        return { ok: false, reason: "malformed", url: "", scheme: "", host: "", plaintext: false };
    }
    var normalised = scheme + "://" + authority.toLowerCase();
    return {
        ok: true,
        reason: "",
        url: normalised,
        scheme: scheme,
        host: host.toLowerCase(),
        plaintext: scheme === "http" && !isLoopback(host),
    };
}

/**
 * Whether this address may be used, given the consent on record.
 *
 * Consent is stored as the address it was granted for, not as a flag. A flag has
 * to be withdrawn by somebody noticing that the address changed; an address
 * withdraws itself, because it stops matching the moment the operator points the
 * plugin somewhere else.
 *
 * @param {import("./types").ParsedUrl} parsed
 * @param {string} consentFor value of the allowPlaintextFor setting
 */
function permitted(parsed, consentFor) {
    if (!parsed.ok) {
        return false;
    }
    if (!parsed.plaintext) {
        return true;
    }
    return (
        String(consentFor || "")
            .trim()
            .toLowerCase() === parsed.url
    );
}

/**
 * Our view of Shepherd, from what we have and what the last attempt returned.
 *
 * Five states, because collapsing them costs the operator the one thing the
 * plugin is for. "Your token was revoked" and "you are off the tailnet" want
 * opposite responses, and only one of them resolves itself while you wait.
 *
 * @param {import("./types").Attempt} attempt
 * @returns {import("./types").State}
 */
function stateFrom(attempt) {
    /** @type {import("./types").Attempt} */
    var a = attempt || {
        baseUrlValid: false,
        permitted: false,
        hasToken: false,
        outcome: "never",
    };
    if (!a.baseUrlValid) {
        return "unconfigured";
    }
    if (!a.permitted) {
        // An address we are configured for but refuse to use unencrypted. Shown
        // like a credential problem because it is the same kind of problem: it
        // needs a decision, and waiting will not fix it.
        return "degraded";
    }
    if (!a.hasToken) {
        return "needs-token";
    }
    switch (a.outcome) {
        case "ok":
            return "ok";
        case "unauthorized":
            return "needs-token";
        case "forbidden":
        case "first-run":
            return "degraded";
        case "unreachable":
        case "timeout":
        case "malformed":
            return "unreachable";
        case "never":
            // Configured and credentialled, but nothing has come back yet.
            return "unreachable";
        default:
            return "unreachable";
    }
}

/**
 * What the outcome of one poll was, from the helper's exit code.
 *
 * The helper reports through its exit status rather than through its output, so
 * that an empty body and a refusal are never the same thing to the caller.
 *
 * @param {number} exitCode
 * @returns {import("./types").Outcome}
 */
function outcomeFromExit(exitCode) {
    switch (exitCode) {
        case 0:
            return "ok";
        // Nothing in the keyring for this address. Not a refusal by Shepherd,
        // but it lands in the same place for the operator — a credential has to
        // be supplied — and it must never read as "unreachable", which would
        // tell them to check their network instead.
        case 2:
            return "unauthorized";
        case 3:
            return "unauthorized";
        case 4:
            return "forbidden";
        case 5:
            return "first-run";
        case 6:
            return "malformed";
        case 7:
            return "unreachable";
        case 124:
            return "timeout";
        default:
            return "unreachable";
    }
}

/**
 * Milliseconds until the next poll.
 *
 * Steady at the configured interval while Shepherd answers; doubling up to a
 * cap while it does not. Never stopping is deliberate: the common reason for
 * failure here is being away from the tailnet, which ends without any signal
 * this plugin could subscribe to, so the only way back is to keep asking —
 * cheaply.
 *
 * @param {number} intervalSec configured poll interval
 * @param {number} failures consecutive failures, 0 when the last poll worked
 * @param {number} [capMs]
 */
function nextDelayMs(intervalSec, failures, capMs) {
    var base = Math.max(15, Math.min(600, Number(intervalSec) || 30)) * 1000;
    var cap = typeof capMs === "number" ? capMs : 300000;
    if (!failures || failures < 1) {
        return base;
    }
    var grown = base * Math.pow(2, Math.min(failures, 10));
    return Math.min(grown, cap);
}

if (typeof module !== "undefined") {
    module.exports = {
        isLoopback: isLoopback,
        parseBaseUrl: parseBaseUrl,
        permitted: permitted,
        stateFrom: stateFrom,
        outcomeFromExit: outcomeFromExit,
        nextDelayMs: nextDelayMs,
    };
}
