import { describe, expect, test } from "bun:test";
import { build, labelFor, repoNameOf, shortAge, ageOf, emptySeen } from "../src/rows.js";
import { describe as describeHold } from "../src/holds.js";

const T0 = 1758200000000;

/** @param {Partial<any>} over */
function session(over) {
    return {
        id: "s1",
        desig: "TASK-1",
        name: "a session",
        repoPath: "/home/p/Work/shepherd",
        status: "running",
        createdAt: T0 - 60000,
        ...over,
    };
}

function buildAt(snapshot, previous, now) {
    return build(snapshot, previous, now, describeHold);
}

describe("reconciling sessions against holds", () => {
    test("a session with no hold is not shown", () => {
        const out = buildAt({ sessions: [session({})], holds: {} }, emptySeen(), T0);
        expect(out.rows).toEqual([]);
        expect(out.counts.needsYou).toBe(0);
    });

    test("a hold whose session is gone is dropped", () => {
        const out = buildAt(
            { sessions: [], holds: { ghost: { code: "blocked-yes-no" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows).toEqual([]);
    });

    test("a session Shepherd calls blocked with no hold is shown, but never counted", () => {
        // Without a hold code we cannot tell "waiting on you" from "waiting on
        // a quota reset", and guessing in favour of an interruption is the one
        // thing the number cannot survive.
        const out = buildAt(
            { sessions: [session({ status: "blocked" })], holds: {} },
            emptySeen(),
            T0,
        );
        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].tier).toBe("working");
        expect(out.rows[0].phrase).toBe("blocked");
        expect(out.counts.needsYou).toBe(0);
    });

    test("a malformed hold entry is treated as no hold", () => {
        const out = buildAt(
            { sessions: [session({})], holds: { s1: { code: "" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows).toEqual([]);
    });

    test("a session without an id is skipped rather than crashing the poll", () => {
        const out = buildAt(
            { sessions: [{ desig: "TASK-9" }, session({})], holds: { s1: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows).toHaveLength(1);
    });

    test("counts are per tier", () => {
        const out = buildAt(
            {
                sessions: [
                    session({ id: "a" }),
                    session({ id: "b" }),
                    session({ id: "c" }),
                    session({ id: "d" }),
                ],
                holds: {
                    a: { code: "blocked-yes-no" },
                    b: { code: "ready-merge" },
                    c: { code: "critic-rework" },
                    d: { code: "halted-usage" },
                },
            },
            emptySeen(),
            T0,
        );
        expect(out.counts).toEqual({ needsYou: 2, working: 1, waiting: 1 });
    });
});

describe("how long a hold has been in place", () => {
    test("is unknown for a session we are seeing for the first time", () => {
        // It may have been held for hours before this shell started. A confident
        // zero would be a lie, and the card shows nothing instead.
        const out = buildAt(
            { sessions: [session({})], holds: { s1: { code: "blocked-yes-no" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows[0].ageExact).toBe(false);
        expect(ageOf(out.rows[0], T0 + 60000)).toBe("");
    });

    test("is measured from the poll where we watched it begin", () => {
        const unheld = buildAt({ sessions: [session({})], holds: {} }, emptySeen(), T0);
        const held = buildAt(
            { sessions: [session({})], holds: { s1: { code: "blocked-yes-no" } } },
            unheld.seen,
            T0 + 30000,
        );
        expect(held.rows[0].ageExact).toBe(true);
        expect(held.rows[0].heldSince).toBe(T0 + 30000);
        expect(ageOf(held.rows[0], T0 + 30000 + 720000)).toBe("12m");
    });

    test("keeps running while the same hold persists", () => {
        const a = buildAt({ sessions: [session({})], holds: {} }, emptySeen(), T0);
        const b = buildAt(
            { sessions: [session({})], holds: { s1: { code: "ci-red" } } },
            a.seen,
            T0 + 1000,
        );
        const c = buildAt(
            { sessions: [session({})], holds: { s1: { code: "ci-red" } } },
            b.seen,
            T0 + 500000,
        );
        expect(c.rows[0].heldSince).toBe(T0 + 1000);
    });

    test("restarts when the hold changes to a different code", () => {
        const a = buildAt(
            { sessions: [session({})], holds: { s1: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        const b = buildAt(
            { sessions: [session({})], holds: { s1: { code: "ready-merge" } } },
            a.seen,
            T0 + 90000,
        );
        expect(b.rows[0].heldSince).toBe(T0 + 90000);
        // We had seen the session before, so this age is a real measurement.
        expect(b.rows[0].ageExact).toBe(true);
    });

    test("is forgotten once the hold clears, so a recurrence starts fresh", () => {
        const a = buildAt(
            { sessions: [session({})], holds: { s1: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        const b = buildAt({ sessions: [session({})], holds: {} }, a.seen, T0 + 1000);
        expect(b.seen.holds.s1).toBeUndefined();
        const c = buildAt(
            { sessions: [session({})], holds: { s1: { code: "ci-red" } } },
            b.seen,
            T0 + 2000,
        );
        expect(c.rows[0].heldSince).toBe(T0 + 2000);
        expect(c.rows[0].ageExact).toBe(true);
    });

    test("does not accumulate entries for sessions that are gone", () => {
        const a = buildAt(
            { sessions: [session({ id: "a" })], holds: { a: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        const b = buildAt(
            { sessions: [session({ id: "b" })], holds: { b: { code: "ci-red" } } },
            a.seen,
            T0 + 1000,
        );
        expect(Object.keys(b.seen.sessions)).toEqual(["b"]);
        expect(Object.keys(b.seen.holds)).toEqual(["b"]);
    });
});

describe("ordering", () => {
    test("puts needs-you above working above waiting", () => {
        const out = buildAt(
            {
                sessions: [
                    session({ id: "w", createdAt: 1 }),
                    session({ id: "q", createdAt: 2 }),
                    session({ id: "n", createdAt: 3 }),
                ],
                holds: {
                    w: { code: "critic-rework" },
                    q: { code: "halted-usage" },
                    n: { code: "blocked-yes-no" },
                },
            },
            emptySeen(),
            T0,
        );
        expect(out.rows.map((r) => r.id)).toEqual(["n", "w", "q"]);
    });

    test("puts the longest-held first within a tier", () => {
        const first = buildAt(
            { sessions: [session({ id: "old" }), session({ id: "new" })], holds: {} },
            emptySeen(),
            T0,
        );
        const second = buildAt(
            {
                sessions: [session({ id: "old" }), session({ id: "new" })],
                holds: { old: { code: "blocked-yes-no" } },
            },
            first.seen,
            T0 + 1000,
        );
        const third = buildAt(
            {
                sessions: [session({ id: "old" }), session({ id: "new" })],
                holds: {
                    old: { code: "blocked-yes-no" },
                    new: { code: "blocked-yes-no" },
                },
            },
            second.seen,
            T0 + 100000,
        );
        expect(third.rows.map((r) => r.id)).toEqual(["old", "new"]);
    });

    test("sorts a hold of unknown age by when its session was created", () => {
        const out = buildAt(
            {
                sessions: [
                    session({ id: "younger", createdAt: T0 - 1000 }),
                    session({ id: "older", createdAt: T0 - 90000 }),
                ],
                holds: {
                    younger: { code: "blocked-yes-no" },
                    older: { code: "blocked-yes-no" },
                },
            },
            emptySeen(),
            T0,
        );
        expect(out.rows.map((r) => r.id)).toEqual(["older", "younger"]);
    });

    test("is stable by label when two rows are otherwise identical", () => {
        const out = buildAt(
            {
                sessions: [
                    session({ id: "b", desig: "TASK-2", createdAt: 5 }),
                    session({ id: "a", desig: "TASK-1", createdAt: 5 }),
                ],
                holds: { a: { code: "ci-red" }, b: { code: "ci-red" } },
            },
            emptySeen(),
            T0,
        );
        expect(out.rows.map((r) => r.label)).toEqual(["TASK-1", "TASK-2"]);
    });
});

describe("what a session is about", () => {
    test("is carried alongside the designation, not instead of it", () => {
        const out = buildAt(
            { sessions: [session({})], holds: { s1: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows[0].label).toBe("TASK-1");
        expect(out.rows[0].name).toBe("a session");
    });

    test("is empty when it would only repeat the label", () => {
        // No designation, so the name is already the label. Printing it twice
        // spends a line saying nothing.
        const out = buildAt(
            { sessions: [session({ desig: "" })], holds: { s1: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows[0].label).toBe("a session");
        expect(out.rows[0].name).toBe("");
    });

    test("is stripped of control characters, being an issue title", () => {
        const out = buildAt(
            {
                sessions: [session({ name: "drop the\u0000 legacy\u001b[31m column" })],
                holds: { s1: { code: "ci-red" } },
            },
            emptySeen(),
            T0,
        );
        expect(out.rows[0].name).toBe("drop the  legacy [31m column");
        expect(out.rows[0].name).not.toContain("\u0000");
    });

    test("is bounded, so one long title cannot stretch the card", () => {
        const out = buildAt(
            { sessions: [session({ name: "x".repeat(400) })], holds: { s1: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows[0].name.length).toBe(120);
        expect(out.rows[0].name.endsWith("\u2026")).toBe(true);
    });

    test("is empty when the session has none", () => {
        const out = buildAt(
            { sessions: [session({ name: "" })], holds: { s1: { code: "ci-red" } } },
            emptySeen(),
            T0,
        );
        expect(out.rows[0].name).toBe("");
    });
});

describe("naming a row", () => {
    test("prefers the designation", () => {
        expect(labelFor(session({}))).toBe("TASK-1");
    });

    test("falls back to the session name", () => {
        expect(labelFor(session({ desig: "" }))).toBe("a session");
    });

    test("falls back to the repo and a short id, never a bare identifier", () => {
        const label = labelFor(session({ desig: "", name: "", id: "8f3adc9912" }));
        expect(label).toBe("shepherd · 8f3adc");
    });

    test("still produces something when there is no repo either", () => {
        const label = labelFor({ id: "8f3adc9912" });
        expect(label).toBe("8f3adc");
    });

    test("takes the repo name off the end of the path", () => {
        expect(repoNameOf("/home/p/Work/shepherd/")).toBe("shepherd");
        expect(repoNameOf("")).toBe("");
        expect(repoNameOf(null)).toBe("");
    });
});

describe("durations", () => {
    test.each([
        [0, "0s"],
        [45000, "45s"],
        [60000, "1m"],
        [720000, "12m"],
        [3600000, "1h"],
        [86400000, "1d"],
        [172800000, "2d"],
    ])("%i ms reads as %s", (ms, expected) => {
        expect(shortAge(ms)).toBe(expected);
    });

    test("refuse to render nonsense", () => {
        expect(shortAge(-1)).toBe("");
        expect(shortAge(NaN)).toBe("");
        expect(shortAge("12")).toBe("");
    });
});
