// Shepherd's hold codes: which of them mean the operator has to act, and what
// each one is called in the card.
//
// Shepherd records why a session is not progressing as one code out of a fixed
// set. It does not record how urgent that is, because for Shepherd the question
// does not arise — its own UI shows the reason in full beside the session. A bar
// indicator has a single integer to say everything with, so the codes are sorted
// into tiers here, and that number can only ever mean one of them.
//
// The division is by who is expected to move next:
//
//   needs-you  nothing happens until the operator does something
//   working    something is already under way and will finish without help
//   waiting    a clock has to run out first, and acting now achieves nothing
//
// Only needs-you is counted. That is the whole contract of the number — this
// many things stop until I act. A code admitted to needs-you that does not meet
// that test costs a context switch every time it appears, and a few of those is
// all it takes for the number to become something you have learned to ignore.
//
// This file is loaded unchanged by both QML and bun, so it uses no imports and
// no syntax newer than the QML engine accepts.

/** @type {Record<string, import("./types").Tier>} */
var TIERS = {
    // The agent is sitting at a prompt. Nobody else can answer it.
    "blocked-menu": "needs-you",
    "blocked-yes-no": "needs-you",
    "blocked-awaiting-input": "needs-you",
    "blocked-stall": "needs-you",
    "blocked-generic": "needs-you",

    // The agent stopped and handed a question back, or stopped because
    // something broke. Both need a person.
    "autopilot-paused": "needs-you",
    "plan-question": "needs-you",
    "halted-error": "needs-you",
    "train-error": "needs-you",

    // Work that is finished but will not land by itself.
    "ready-merge": "needs-you",
    "manual-steps": "needs-you",
    "recap-attention": "needs-you",

    // Under way. An agent is addressing findings, or the merge train is moving.
    // With Auto-Address on, these close themselves out with nobody watching.
    "plan-rework": "working",
    "critic-rework": "working",
    "ci-red": "working",
    "pr-conflict": "working",
    "awaiting-merge": "working",
    merging: "working",
    "merge-rebasing": "working",
    stalled: "working",

    // A usage window has to reset. The time is in HoldParams.resetAt.
    "halted-usage": "waiting",
    "quota-rework": "waiting",
    "quota-review": "waiting",
    "quota-error": "waiting",
    "quota-plan": "waiting",
};

// Written in the second person wherever the operator is the one who has to
// move, so a row reads as an instruction rather than as a status.
/** @type {Record<string, string>} */
var PHRASES = {
    "blocked-menu": "waiting on a choice",
    "blocked-yes-no": "waiting on a yes or no",
    "blocked-awaiting-input": "waiting for input",
    "blocked-stall": "stopped mid-answer",
    "blocked-generic": "waiting on you",

    "autopilot-paused": "handed a question back",
    "plan-question": "plan has a question",
    "halted-error": "stopped on an error",
    "train-error": "merge train failed",

    "ready-merge": "ready to merge",
    "manual-steps": "manual steps to do",
    "recap-attention": "recap needs a look",

    "plan-rework": "reworking the plan",
    "critic-rework": "addressing review findings",
    "ci-red": "CI is red",
    "pr-conflict": "PR has conflicts",
    "awaiting-merge": "waiting to merge",
    merging: "landing on the base branch",
    "merge-rebasing": "rebasing onto its base",
    stalled: "not making progress",

    "halted-usage": "usage limit reached",
    "quota-rework": "rework quota reached",
    "quota-review": "review quota reached",
    "quota-error": "error quota reached",
    "quota-plan": "plan quota reached",
};

/**
 * The tier a hold code belongs to.
 *
 * An unrecognised code is working: never needs-you, and never dropped. Shepherd
 * ships faster than this plugin does, so an unknown code is expected rather than
 * exceptional, and both alternatives are ways of being wrong. Dropping it hides
 * a session that is genuinely stuck. Counting it makes every Shepherd release a
 * possible false alarm that cannot be corrected without a plugin update. In
 * working it is visible the moment the card is opened, carrying its own code as
 * its description — which is also the bug report.
 *
 * @param {string} code
 * @returns {import("./types").Tier}
 */
function tierOf(code) {
    return Object.prototype.hasOwnProperty.call(TIERS, code) ? TIERS[code] : "working";
}

/** @param {string} code */
function isKnown(code) {
    return Object.prototype.hasOwnProperty.call(TIERS, code);
}

/**
 * Format an epoch-millisecond instant as a local clock time.
 *
 * @param {number} epochMs
 * @param {(ms: number) => Date} [makeDate] seam for tests
 */
function clockTime(epochMs, makeDate) {
    var d = makeDate ? makeDate(epochMs) : new Date(epochMs);
    var hh = String(d.getHours());
    var mm = String(d.getMinutes());
    return (hh.length < 2 ? "0" + hh : hh) + ":" + (mm.length < 2 ? "0" + mm : mm);
}

/**
 * Strip control characters from a string Shepherd relayed from somewhere else,
 * and bound its length.
 *
 * Everything that reaches a text element goes through here first. A session
 * name comes from an issue title, and an agent's hand-back question is whatever
 * the agent wrote.
 *
 * @param {string} value
 * @param {number} [maxLen]
 */
function clean(value, maxLen) {
    var limit = typeof maxLen === "number" ? maxLen : 240;
    if (typeof value !== "string") {
        return "";
    }
    // eslint-disable-next-line no-control-regex
    var stripped = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    return stripped.length > limit ? stripped.slice(0, limit - 1) + "…" : stripped;
}

/**
 * The phrase for one hold, with its parameters folded in.
 *
 * @param {import("./types").Hold} hold
 * @param {(ms: number) => Date} [makeDate]
 */
function phraseFor(hold, makeDate) {
    if (!hold || typeof hold.code !== "string") {
        return "held";
    }
    if (!isKnown(hold.code)) {
        return "held (" + clean(hold.code, 60) + ")";
    }
    var base = PHRASES[hold.code];
    var p = hold.params || {};
    switch (hold.code) {
        case "critic-rework":
            return typeof p.findings === "number" && p.findings > 0
                ? base + " (" + p.findings + ")"
                : base;
        case "plan-rework":
            return typeof p.round === "number" && typeof p.cap === "number"
                ? base + " (round " + p.round + " of " + p.cap + ")"
                : base;
        case "merge-rebasing":
            return typeof p.rebaseCount === "number" && p.rebaseCount > 1
                ? base + " (attempt " + p.rebaseCount + ")"
                : base;
        case "manual-steps":
            return typeof p.steps === "number" && p.steps > 0
                ? p.steps + " manual step" + (p.steps === 1 ? "" : "s") + " to do"
                : base;
        case "halted-usage":
        case "quota-rework":
        case "quota-review":
        case "quota-error":
        case "quota-plan":
            return typeof p.resetAt === "number" && p.resetAt > 0
                ? base + ", resets " + clockTime(p.resetAt, makeDate)
                : base;
        default:
            return base;
    }
}

/**
 * Tier and phrase together — the one function the row builder needs, so that
 * this file stays the only place that knows a hold code from a hole in the
 * ground.
 *
 * @param {import("./types").Hold} hold
 * @param {(ms: number) => Date} [makeDate]
 * @returns {import("./types").Described}
 */
function describe(hold, makeDate) {
    var code = hold && typeof hold.code === "string" ? hold.code : "";
    return {
        code: code,
        tier: tierOf(code),
        known: isKnown(code),
        phrase: phraseFor(hold, makeDate),
        question:
            hold && hold.params && typeof hold.params.question === "string"
                ? clean(hold.params.question)
                : "",
    };
}

if (typeof module !== "undefined") {
    module.exports = {
        TIERS: TIERS,
        PHRASES: PHRASES,
        tierOf: tierOf,
        isKnown: isKnown,
        phraseFor: phraseFor,
        clockTime: clockTime,
        clean: clean,
        describe: describe,
    };
}
