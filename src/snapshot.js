// Reading what bin/poll.sh printed.
//
// Five bodies, each introduced by a marker line:
//
//     --sessions--              a JSON array
//     --holds--                 a JSON object
//     --git--                   a JSON object
//     --reviews-inflight--      a JSON array of session ids, or null
//     --plan-gates-inflight--   a JSON array of session ids, or null
//
// The markers sit on lines of their own and each body is single-line JSON as
// Shepherd serialises it, so this is a split rather than a parse. The first
// three are required: a snapshot missing any of them is no snapshot, because a
// count derived from part of the herd is a count that lies. The last two are
// optional — they joined Shepherd's read scope after 1.47.0 — and "null" means
// not known, which is a normal answer rather than a failure.
//
// Lived in Service.qml until the optional sections arrived, where nothing could
// test it. Loaded unchanged by both QML and bun; no imports.

/** Session ids are UUIDs; anything wildly longer is not one of them. */
var MAX_ID_LENGTH = 128;

/** A herd in the thousands is not a herd. Past this the list is refused. */
var MAX_IN_FLIGHT = 5000;

var MARKERS = [
    "--sessions--",
    "--holds--",
    "--git--",
    "--reviews-inflight--",
    "--plan-gates-inflight--",
];

/**
 * Split the helper's output into its bodies, keyed by marker.
 *
 * @param {string} text
 * @returns {Record<string, string> | null}
 */
function splitBodies(text) {
    if (typeof text !== "string") {
        return null;
    }
    var lines = text.split("\n");
    /** @type {Record<string, string>} */
    var bodies = {};
    for (var i = 0; i < lines.length; i++) {
        if (MARKERS.indexOf(lines[i]) >= 0) {
            if (i + 1 >= lines.length) {
                return null;
            }
            bodies[lines[i]] = lines[i + 1];
            i++;
        }
    }
    return bodies;
}

/**
 * A list of session ids, or [] when the list is not known.
 *
 * Both "the instance does not offer this" and "this came back malformed" end
 * up as []: an empty exclusion set, which is exactly the behaviour from before
 * these routes existed. That is the failure worth having — the card shows a
 * session as your turn slightly early, rather than showing nothing at all.
 *
 * @param {string | undefined} body
 * @returns {string[]}
 */
function idList(body) {
    if (typeof body !== "string" || body === "null") {
        return [];
    }
    var parsed;
    try {
        parsed = JSON.parse(body);
    } catch (e) {
        return [];
    }
    if (!Array.isArray(parsed) || parsed.length > MAX_IN_FLIGHT) {
        return [];
    }
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
        var id = parsed[i];
        if (typeof id === "string" && id !== "" && id.length <= MAX_ID_LENGTH) {
            out.push(id);
        }
    }
    return out;
}

/**
 * The whole snapshot, or null if the required part of it is missing or broken.
 *
 * @param {string} text what bin/poll.sh printed
 * @returns {import("./types").Snapshot | null}
 */
function parse(text) {
    var bodies = splitBodies(text);
    if (!bodies) {
        return null;
    }
    var sessions;
    var holds;
    var git;
    try {
        sessions = JSON.parse(bodies["--sessions--"]);
        holds = JSON.parse(bodies["--holds--"]);
        git = JSON.parse(bodies["--git--"]);
    } catch (e) {
        return null;
    }
    if (!Array.isArray(sessions)) {
        return null;
    }
    if (!holds || typeof holds !== "object" || Array.isArray(holds)) {
        return null;
    }
    if (!git || typeof git !== "object" || Array.isArray(git)) {
        return null;
    }

    // The HUD's own test: a critic run OR a plan-gate run in flight parks the
    // session as "reviewer running". Either list alone is still worth using.
    var seen = {};
    var inReview = [];
    var lists = [idList(bodies["--reviews-inflight--"]), idList(bodies["--plan-gates-inflight--"])];
    for (var l = 0; l < lists.length; l++) {
        for (var i = 0; i < lists[l].length; i++) {
            if (!Object.prototype.hasOwnProperty.call(seen, lists[l][i])) {
                seen[lists[l][i]] = true;
                inReview.push(lists[l][i]);
            }
        }
    }

    return { sessions: sessions, holds: holds, git: git, inReview: inReview };
}

if (typeof module !== "undefined") {
    module.exports = { parse: parse, idList: idList, splitBodies: splitBodies, MARKERS: MARKERS };
}
