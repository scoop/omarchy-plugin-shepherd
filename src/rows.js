// Turning three snapshots into what the card shows.
//
// Shepherd answers `GET /api/sessions` and `GET /api/holds` separately, so they
// are two views of one moment taken a fraction apart and they will disagree.
// Which one wins is a decision, not a detail:
//
//   - A hold whose session is absent from the list is dropped. The session was
//     archived between the two calls; the hold is a straggler.
//   - A session with no hold is not shown at all. Nothing is waiting on it.
//   - A session whose status is "blocked" but which has no hold entry is shown
//     as working, never as needs-you. Shepherd's hold code is the thing that
//     separates "waiting on you" from "waiting on a quota reset", and without
//     one this plugin genuinely does not know which it is. Claiming the
//     operator's attention on a guess is the one failure the number cannot
//     survive.
//
// Holds are fetched after sessions so that the window between them skews toward
// stragglers, which are discarded, rather than toward missing rows.
//
// This file is loaded unchanged by both QML and bun. It takes `describe` as an
// argument rather than importing src/holds.js, because QML's JavaScript engine
// has no module loader: the caller passes it in.

/**
 * How long a hold has been in place, and whether that is a real measurement.
 *
 * Shepherd does not timestamp holds — HoldReason is a code and its parameters,
 * nothing else — and `session.updatedAt` is not a substitute: it moves on any
 * write at all, so a session stuck for forty minutes that got an activity update
 * ten seconds ago would sort as the freshest thing on the list, which is the
 * exact inversion of what the ordering is for.
 *
 * So the age is ours, not Shepherd's: the moment this plugin first saw this
 * session under this code. That is only a real duration when we also saw the
 * session before it was held. A hold that was already in place the first time we
 * looked — because the shell just started, or because the session is new to us —
 * has been in place for an unknown time, and is marked inexact so the card can
 * show no age rather than a confident zero.
 *
 * @param {import("./types").Snapshot} snapshot
 * @param {import("./types").Seen} previous
 * @param {number} now epoch ms
 * @param {(hold: import("./types").Hold) => import("./types").Described} describe
 * @returns {import("./types").Built}
 */
function build(snapshot, previous, now, describe) {
    var sessions = (snapshot && snapshot.sessions) || [];
    var holds = (snapshot && snapshot.holds) || {};
    var prevSessions = (previous && previous.sessions) || {};
    var prevHolds = (previous && previous.holds) || {};

    /** @type {import("./types").Seen} */
    var seen = { sessions: {}, holds: {} };
    /** @type {import("./types").Row[]} */
    var rows = [];

    for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        if (!s || typeof s.id !== "string") {
            continue;
        }
        seen.sessions[s.id] = true;

        var hold = Object.prototype.hasOwnProperty.call(holds, s.id) ? holds[s.id] : null;
        if (!hold || typeof hold.code !== "string" || hold.code === "") {
            // No hold entry, but Shepherd calls it blocked: show it, quietly.
            if (s.status === "blocked") {
                rows.push(
                    makeRow(
                        s,
                        {
                            code: "",
                            tier: "working",
                            known: false,
                            phrase: "blocked",
                            question: "",
                        },
                        null,
                        false,
                    ),
                );
            }
            continue;
        }

        var d = describe(hold);
        var prior = Object.prototype.hasOwnProperty.call(prevHolds, s.id) ? prevHolds[s.id] : null;
        var firstSeen;
        var exact;
        if (prior && prior.code === d.code) {
            // Same hold as last time: keep its clock and its honesty about it.
            firstSeen = prior.firstSeen;
            exact = prior.exact === true;
        } else {
            firstSeen = now;
            // We watched this change only if we had already seen the session.
            exact = Object.prototype.hasOwnProperty.call(prevSessions, s.id);
        }
        seen.holds[s.id] = { code: d.code, firstSeen: firstSeen, exact: exact };
        rows.push(makeRow(s, d, firstSeen, exact));
    }

    rows.sort(compareRows);

    return {
        rows: rows,
        seen: seen,
        counts: {
            needsYou: countTier(rows, "needs-you"),
            working: countTier(rows, "working"),
            waiting: countTier(rows, "waiting"),
        },
    };
}

/**
 * @param {any} session
 * @param {import("./types").Described} described
 * @param {number|null} firstSeen
 * @param {boolean} exact
 * @returns {import("./types").Row}
 */
function makeRow(session, described, firstSeen, exact) {
    return {
        id: session.id,
        label: labelFor(session),
        repo: repoNameOf(session.repoPath),
        tier: described.tier,
        code: described.code,
        phrase: described.phrase,
        question: described.question,
        heldSince: firstSeen,
        ageExact: exact,
        createdAt: typeof session.createdAt === "number" ? session.createdAt : 0,
    };
}

/**
 * What a row is called.
 *
 * Shepherd's desig is the label everywhere else — TASK-435 — but plain and
 * terminal sessions may not have one. A row nobody can identify is a row nobody
 * can act on, and the whole plugin is one screen of rows, so there is always a
 * fallback and it is never a bare identifier.
 *
 * @param {any} session
 */
function labelFor(session) {
    if (typeof session.desig === "string" && session.desig !== "") {
        return session.desig;
    }
    if (typeof session.name === "string" && session.name !== "") {
        return session.name;
    }
    var repo = repoNameOf(session.repoPath);
    var short = String(session.id).slice(0, 6);
    return repo ? repo + " · " + short : short;
}

/** @param {string} repoPath */
function repoNameOf(repoPath) {
    if (typeof repoPath !== "string" || repoPath === "") {
        return "";
    }
    var parts = repoPath.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || "";
}

var TIER_ORDER = { "needs-you": 0, working: 1, waiting: 2 };

/**
 * Tier first, then oldest first.
 *
 * A row with an inexact age sorts on the session's own creation instead, which
 * is always earlier than any hold could have started, so rows we have been
 * watching the longest — including the ones that predate this shell — come
 * first. That is the same intent, not a different one: the thing most likely to
 * have been forgotten goes at the top.
 *
 * @param {import("./types").Row} a
 * @param {import("./types").Row} b
 */
function compareRows(a, b) {
    var ta = TIER_ORDER[a.tier];
    var tb = TIER_ORDER[b.tier];
    if (ta !== tb) {
        return ta - tb;
    }
    var ka = a.ageExact && a.heldSince !== null ? a.heldSince : a.createdAt;
    var kb = b.ageExact && b.heldSince !== null ? b.heldSince : b.createdAt;
    if (ka !== kb) {
        return ka - kb;
    }
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * @param {import("./types").Row[]} rows
 * @param {string} tier
 */
function countTier(rows, tier) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].tier === tier) {
            n++;
        }
    }
    return n;
}

/**
 * A duration in the shortest form that is still true: 45s, 12m, 3h, 2d.
 *
 * @param {number} ms
 */
function shortAge(ms) {
    if (typeof ms !== "number" || !isFinite(ms) || ms < 0) {
        return "";
    }
    var s = Math.floor(ms / 1000);
    if (s < 60) {
        return s + "s";
    }
    var m = Math.floor(s / 60);
    if (m < 60) {
        return m + "m";
    }
    var h = Math.floor(m / 60);
    if (h < 24) {
        return h + "h";
    }
    return Math.floor(h / 24) + "d";
}

/**
 * The age to print beside a row, or "" when we do not honestly know it.
 *
 * @param {import("./types").Row} row
 * @param {number} now epoch ms
 */
function ageOf(row, now) {
    if (!row.ageExact || row.heldSince === null) {
        return "";
    }
    return shortAge(now - row.heldSince);
}

/**
 * The empty state, for a service that has not polled yet.
 * @returns {import("./types").Seen}
 */
function emptySeen() {
    return { sessions: {}, holds: {} };
}

if (typeof module !== "undefined") {
    module.exports = {
        build: build,
        labelFor: labelFor,
        repoNameOf: repoNameOf,
        compareRows: compareRows,
        shortAge: shortAge,
        ageOf: ageOf,
        emptySeen: emptySeen,
    };
}
