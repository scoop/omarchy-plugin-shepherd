// Shepherd's "Your turn", computed the way Shepherd computes it.
//
// A session whose pull request is open, green and handed back to the operator
// carries no hold at all. Shepherd's attention rules give it the signal
// "in-flight", and in-flight is the one signal with no hold code, so it never
// appears in GET /api/holds — which is why a card built only from holds is
// blind to the group Shepherd's own HUD labels "Your turn (N)" and describes
// as "a pull request is open, CI is green, and the agent handed off — your turn
// to review and merge. This is the payoff: finished work waiting for a click."
//
// It is a lifecycle stage, derived from the session and its PR state, not an
// attention code. This file mirrors the predicate from Shepherd's
// ui/src/lib/components/herd-partition.ts so the bar and the HUD agree about
// whose turn it is. If that file changes, this one has to follow.
//
// Loaded unchanged by both QML and bun; no imports.

/**
 * Shepherd's checksCleared, mirrored.
 *
 * CI is cleared when it is green, or when the repo has no CI to wait on — a
 * GitHub repo with zero workflows, which the server stamps as `noCi` — and the
 * checks have settled at their terminal "none".
 *
 * @param {string} checks
 * @param {boolean} [noCi]
 */
function checksCleared(checks, noCi) {
    return checks === "success" || (noCi === true && checks === "none");
}

/**
 * Whether the PR is open, CI has cleared, and the agent has stepped out.
 *
 * The raw status is what counts, by design on Shepherd's side: a session that
 * is "working while blocked" displays as running but is raw "blocked", and both
 * are excluded here, so the display flag cannot change the answer. That is
 * lucky as well as correct — /api/working-blocked is outside the read scope
 * this plugin holds, and it could not be consulted even if it mattered.
 *
 * @param {import("./types").Session} session
 * @param {import("./types").GitState} git
 */
function greenIdle(session, git) {
    if (!git || git.state !== "open") {
        return false;
    }
    if (!checksCleared(git.checks, git.noCi)) {
        return false;
    }
    return session.status !== "running" && session.status !== "blocked";
}

/**
 * Whose turn a green, idle PR is.
 *
 * A draft awaits the operator's own sign-off and is not yet a merge. A reviewer
 * or merger named in the repo's roles file takes the turn instead — Shepherd
 * stamps that as `handoff`, which is what lets the herd say "waiting on scoop"
 * rather than "your turn". Otherwise it is the operator's.
 *
 * @param {import("./types").GitState} git
 * @returns {import("./types").Stage}
 */
function handoffStage(git) {
    if (git.isDraft) {
        return "draft-awaiting-signoff";
    }
    if (git.handoff === "reviewer") {
        return "waiting-on-reviewer";
    }
    if (git.handoff === "merger") {
        return "waiting-on-merger";
    }
    return "your-turn";
}

/**
 * Whether this session is the operator's turn.
 *
 * Deliberately narrower than Shepherd's full partition. Shepherd also parks a
 * session while a critic run or a rework loop is in flight, and both of those
 * live behind /api/reviews and /api/plan-gates, which a read-scoped token
 * cannot reach. A session whose critic is mid-run therefore shows here a little
 * early rather than not at all. The alternatives were worse: asking every user
 * of this plugin for a token that can also merge their pull requests, or
 * leaving the group out entirely — which is the bug this file exists to fix.
 *
 * Sessions the operator has flagged ready, and ones a merge train is carrying,
 * are excluded: Shepherd renders those as their own groups, and each already
 * has a hold code of its own that the card shows.
 *
 * @param {import("./types").Session} session
 * @param {import("./types").GitState} git
 * @param {number} now epoch ms
 */
function isYourTurn(session, git, now) {
    if (!session || !git) {
        return false;
    }
    if (session.readyToMerge === true) {
        return false;
    }
    if (isMerging(session, now)) {
        return false;
    }
    if (!greenIdle(session, git)) {
        return false;
    }
    return handoffStage(git) === "your-turn";
}

/**
 * Whether a merge train is carrying this session right now.
 *
 * `mergingSince` is stamped when the train picks it up. The window bounds a
 * stamp nothing ever cleared — a train that died holding one should not park a
 * session out of sight forever.
 *
 * @param {import("./types").Session} session
 * @param {number} now epoch ms
 * @param {number} [ttlMs]
 */
function isMerging(session, now, ttlMs) {
    var ttl = typeof ttlMs === "number" ? ttlMs : 600000;
    if (!session || typeof session.mergingSince !== "number" || session.mergingSince <= 0) {
        return false;
    }
    return now - session.mergingSince < ttl;
}

/** What the card calls it. Shepherd's own words for the same state. */
var YOUR_TURN_PHRASE = "ready to review and merge";

if (typeof module !== "undefined") {
    module.exports = {
        checksCleared: checksCleared,
        greenIdle: greenIdle,
        handoffStage: handoffStage,
        isYourTurn: isYourTurn,
        isMerging: isMerging,
        YOUR_TURN_PHRASE: YOUR_TURN_PHRASE,
    };
}
