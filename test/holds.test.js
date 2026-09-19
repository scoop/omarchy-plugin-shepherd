import { describe, expect, test } from "bun:test";
import {
    TIERS,
    PHRASES,
    tierOf,
    isKnown,
    phraseFor,
    clockTime,
    clean,
    describe as describeHold,
} from "../src/holds.js";

// The list Shepherd ships, as of the version this plugin was written against.
// Its purpose is to fail when Shepherd adds a code, so that somebody decides
// which tier it belongs in rather than letting the fallback decide silently.
const SHEPHERD_CODES = [
    "halted-error",
    "halted-usage",
    "autopilot-paused",
    "blocked-menu",
    "blocked-yes-no",
    "blocked-awaiting-input",
    "blocked-stall",
    "blocked-generic",
    "quota-rework",
    "quota-review",
    "quota-error",
    "quota-plan",
    "plan-rework",
    "plan-question",
    "critic-rework",
    "ci-red",
    "pr-conflict",
    "awaiting-merge",
    "train-error",
    "stalled",
    "recap-attention",
    "merging",
    "merge-rebasing",
    "ready-merge",
    "manual-steps",
];

describe("the tier table", () => {
    test("covers every hold code Shepherd defines", () => {
        const missing = SHEPHERD_CODES.filter((c) => !isKnown(c));
        expect(missing).toEqual([]);
    });

    test("defines nothing Shepherd does not", () => {
        const extra = Object.keys(TIERS).filter((c) => !SHEPHERD_CODES.includes(c));
        expect(extra).toEqual([]);
    });

    test("gives every code a phrase", () => {
        const unphrased = Object.keys(TIERS).filter((c) => !PHRASES[c]);
        expect(unphrased).toEqual([]);
    });

    test("uses only the three tiers", () => {
        const tiers = new Set(Object.values(TIERS));
        expect([...tiers].sort()).toEqual(["needs-you", "waiting", "working"]);
    });
});

describe("what counts as needing you", () => {
    // These are the promise the number makes. Moving one of them out of
    // needs-you is a product decision, and should have to break a test first.
    test.each([
        "blocked-menu",
        "blocked-yes-no",
        "blocked-awaiting-input",
        "blocked-stall",
        "blocked-generic",
        "autopilot-paused",
        "plan-question",
        "halted-error",
        "train-error",
        "ready-merge",
        "manual-steps",
        "recap-attention",
        "awaiting-merge",
    ])("%s stops until the operator acts", (code) => {
        expect(tierOf(code)).toBe("needs-you");
    });

    // An agent or the merge train is on these. Counting them would interrupt
    // the operator for work already under way.
    test.each([
        "plan-rework",
        "critic-rework",
        "ci-red",
        "pr-conflict",
        "merging",
        "merge-rebasing",
        "stalled",
    ])("%s is already being worked", (code) => {
        expect(tierOf(code)).toBe("working");
    });

    // Acting on these achieves nothing until a clock runs out.
    test.each(["halted-usage", "quota-rework", "quota-review", "quota-error", "quota-plan"])(
        "%s is waiting on a clock",
        (code) => {
            expect(tierOf(code)).toBe("waiting");
        },
    );
});

describe("a hold code this plugin has never heard of", () => {
    test("is never counted", () => {
        expect(tierOf("some-future-code")).toBe("working");
    });

    test("is never dropped, and says what it was", () => {
        const d = describeHold({ code: "some-future-code" });
        expect(d.tier).toBe("working");
        expect(d.known).toBe(false);
        expect(d.phrase).toContain("some-future-code");
    });

    test("cannot smuggle markup or control characters into the card", () => {
        const d = describeHold({ code: "evil\u0000<b>code</b>\u001b[31m" });
        expect(d.phrase).not.toContain("\u0000");
        expect(d.phrase).not.toContain("\u001b");
    });

    test("cannot be arbitrarily long", () => {
        const d = describeHold({ code: "x".repeat(500) });
        expect(d.phrase.length).toBeLessThan(120);
    });
});

describe("phrases", () => {
    test("do not restate the code", () => {
        for (const code of SHEPHERD_CODES) {
            expect(PHRASES[code]).not.toBe(code);
        }
    });

    test("fold in the open finding count", () => {
        expect(phraseFor({ code: "critic-rework", params: { findings: 3 } })).toBe(
            "addressing review findings (3)",
        );
    });

    test("omit a finding count of zero rather than printing it", () => {
        expect(phraseFor({ code: "critic-rework", params: { findings: 0 } })).toBe(
            "addressing review findings",
        );
    });

    test("fold in the plan rework round", () => {
        expect(phraseFor({ code: "plan-rework", params: { round: 2, cap: 3 } })).toBe(
            "reworking the plan (round 2 of 3)",
        );
    });

    test("count manual steps in the phrase itself", () => {
        expect(phraseFor({ code: "manual-steps", params: { steps: 1 } })).toBe(
            "1 manual step to do",
        );
        expect(phraseFor({ code: "manual-steps", params: { steps: 4 } })).toBe(
            "4 manual steps to do",
        );
    });

    test("tell you when a usage window resets", () => {
        const at = 1758200000000;
        const phrase = phraseFor({ code: "halted-usage", params: { resetAt: at } }, (ms) => {
            const d = new Date(ms);
            d.getHours = () => 14;
            d.getMinutes = () => 5;
            return d;
        });
        expect(phrase).toBe("usage limit, resets 14:05");
    });

    test("survive a hold with no parameters at all", () => {
        for (const code of SHEPHERD_CODES) {
            expect(phraseFor({ code }).length).toBeGreaterThan(0);
        }
    });

    test("survive a hold that is not a hold", () => {
        expect(phraseFor(null)).toBe("held");
        expect(phraseFor({})).toBe("held");
        expect(phraseFor({ code: 42 })).toBe("held");
    });
});

describe("clock times", () => {
    test("are zero-padded on both halves", () => {
        const at = 0;
        const out = clockTime(at, (ms) => {
            const d = new Date(ms);
            d.getHours = () => 9;
            d.getMinutes = () => 7;
            return d;
        });
        expect(out).toBe("09:07");
    });
});

describe("cleaning relayed text", () => {
    test("strips control characters", () => {
        expect(clean("a\u0000b\u001bc")).toBe("a b c");
    });

    test("bounds length and marks the truncation", () => {
        const out = clean("x".repeat(400), 20);
        expect(out.length).toBe(20);
        expect(out.endsWith("…")).toBe(true);
    });

    test("is empty for anything that is not a string", () => {
        expect(clean(null)).toBe("");
        expect(clean(17)).toBe("");
    });
});

describe("an agent's hand-back question", () => {
    test("is carried through verbatim, bounded and stripped", () => {
        const d = describeHold({
            code: "autopilot-paused",
            params: { question: "Should I drop the\u0000 legacy column?" },
        });
        expect(d.question).toBe("Should I drop the  legacy column?");
    });

    test("is empty when the agent did not ask one", () => {
        expect(describeHold({ code: "ci-red" }).question).toBe("");
    });
});
