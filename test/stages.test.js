import { describe, expect, test } from "bun:test";
import { checksCleared, greenIdle, handoffStage, isYourTurn, isMerging } from "../src/stages.js";

const NOW = 1758200000000;

function session(over) {
    return { id: "s1", status: "idle", readyToMerge: false, mergingSince: null, ...over };
}

function git(over) {
    return { state: "open", checks: "success", isDraft: false, ...over };
}

describe("when CI counts as cleared", () => {
    test("green is cleared", () => {
        expect(checksCleared("success", false)).toBe(true);
    });

    test("a repo with no CI at all is cleared once checks settle at none", () => {
        // A GitHub repo with zero workflows. The server stamps noCi; without it
        // "none" only means CI has not reported yet.
        expect(checksCleared("none", true)).toBe(true);
        expect(checksCleared("none", false)).toBe(false);
    });

    test.each(["pending", "failure"])("%s is not cleared", (checks) => {
        expect(checksCleared(checks, false)).toBe(false);
        expect(checksCleared(checks, true)).toBe(false);
    });
});

describe("whether the agent has stepped out", () => {
    test("an idle session with an open green PR has", () => {
        expect(greenIdle(session({}), git({}))).toBe(true);
    });

    test.each(["running", "blocked"])("a %s session has not", (status) => {
        // Raw status by design, as in Shepherd: a working-while-blocked session
        // displays as running but is raw blocked, and both are excluded — so the
        // display flag cannot change the answer, and /api/working-blocked (out of
        // this plugin's scope) never needs consulting.
        expect(greenIdle(session({ status }), git({}))).toBe(false);
    });

    test.each(["none", "merged", "closed"])("a PR in state %s has not", (state) => {
        expect(greenIdle(session({}), git({ state }))).toBe(false);
    });

    test("no PR at all has not", () => {
        expect(greenIdle(session({}), null)).toBe(false);
        expect(greenIdle(session({}), undefined)).toBe(false);
    });

    test("CI still running has not", () => {
        expect(greenIdle(session({}), git({ checks: "pending" }))).toBe(false);
    });
});

describe("whose turn a green idle PR is", () => {
    test("the operator's, by default", () => {
        expect(handoffStage(git({}))).toBe("your-turn");
    });

    test("a draft awaits the operator's own sign-off, which is a different thing", () => {
        expect(handoffStage(git({ isDraft: true }))).toBe("draft-awaiting-signoff");
    });

    test("a named reviewer takes the turn", () => {
        expect(handoffStage(git({ handoff: "reviewer" }))).toBe("waiting-on-reviewer");
    });

    test("a named merger takes the turn", () => {
        expect(handoffStage(git({ handoff: "merger" }))).toBe("waiting-on-merger");
    });

    test("a draft outranks a named reviewer", () => {
        expect(handoffStage(git({ isDraft: true, handoff: "reviewer" }))).toBe(
            "draft-awaiting-signoff",
        );
    });
});

describe("your turn", () => {
    test("is the finished work waiting for a click", () => {
        expect(isYourTurn(session({}), git({}), NOW)).toBe(true);
    });

    test.each([
        ["the agent is still running", { status: "running" }, {}],
        ["the agent is blocked", { status: "blocked" }, {}],
        ["CI has not finished", {}, { checks: "pending" }],
        ["CI failed", {}, { checks: "failure" }],
        ["the PR is a draft", {}, { isDraft: true }],
        ["someone else reviews", {}, { handoff: "reviewer" }],
        ["someone else merges", {}, { handoff: "merger" }],
        ["there is no PR", {}, { state: "none" }],
        ["the PR already landed", {}, { state: "merged" }],
    ])("is not, when %s", (_why, sOver, gOver) => {
        expect(isYourTurn(session(sOver), git(gOver), NOW)).toBe(false);
    });

    test("is not, for a session the operator already flagged ready", () => {
        // Shepherd renders that as its own group, and it has a hold code of its
        // own that the card already shows.
        expect(isYourTurn(session({ readyToMerge: true }), git({}), NOW)).toBe(false);
    });

    test("is not, while a merge train is carrying it", () => {
        expect(isYourTurn(session({ mergingSince: NOW - 1000 }), git({}), NOW)).toBe(false);
    });

    test("is, once a stale merge stamp has aged out", () => {
        // A train that died holding a session must not park it out of sight for
        // good.
        expect(isYourTurn(session({ mergingSince: NOW - 3600000 }), git({}), NOW)).toBe(true);
    });

    test("survives a session or a git state that is not there", () => {
        expect(isYourTurn(null, git({}), NOW)).toBe(false);
        expect(isYourTurn(session({}), null, NOW)).toBe(false);
    });
});

describe("merge train stamps", () => {
    test("count while fresh", () => {
        expect(isMerging(session({ mergingSince: NOW - 1000 }), NOW)).toBe(true);
    });

    test("expire, so a dead train cannot park a session forever", () => {
        expect(isMerging(session({ mergingSince: NOW - 3600000 }), NOW)).toBe(false);
    });

    test("are absent when never stamped", () => {
        expect(isMerging(session({}), NOW)).toBe(false);
        expect(isMerging(session({ mergingSince: 0 }), NOW)).toBe(false);
    });
});
