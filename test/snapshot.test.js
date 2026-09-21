import { describe, expect, test } from "bun:test";
import { parse, idList } from "../src/snapshot.js";

/** What bin/poll.sh prints, with any section overridable. */
function output(over = {}) {
    const sections = {
        "--sessions--": "[]",
        "--holds--": "{}",
        "--git--": "{}",
        "--reviews-inflight--": "[]",
        "--plan-gates-inflight--": "[]",
        ...over,
    };
    return (
        Object.entries(sections)
            .filter(([, body]) => body !== undefined)
            .map(([marker, body]) => marker + "\n" + body)
            .join("\n") + "\n"
    );
}

describe("a snapshot", () => {
    test("parses when every section is present", () => {
        const out = parse(
            output({
                "--sessions--": '[{"id":"a"}]',
                "--holds--": '{"a":{"code":"ci-red"}}',
                "--git--": '{"a":{"state":"open"}}',
            }),
        );
        expect(out.sessions).toEqual([{ id: "a" }]);
        expect(out.holds).toEqual({ a: { code: "ci-red" } });
        expect(out.git).toEqual({ a: { state: "open" } });
    });

    test.each(["--sessions--", "--holds--", "--git--"])(
        "is refused without its %s section",
        (marker) => {
            // A count derived from part of the herd is a count that lies.
            expect(parse(output({ [marker]: undefined }))).toBeNull();
        },
    );

    test.each([
        ["sessions that are not a list", { "--sessions--": "{}" }],
        ["holds that are a list", { "--holds--": "[]" }],
        ["git that is a list", { "--git--": "[]" }],
        ["sessions that are not JSON", { "--sessions--": "nope" }],
        ["holds that are null", { "--holds--": "null" }],
    ])("is refused with %s", (_why, over) => {
        expect(parse(output(over))).toBeNull();
    });

    test("is refused when it is not text at all", () => {
        expect(parse(null)).toBeNull();
        expect(parse(undefined)).toBeNull();
    });

    test("is refused when a marker is the last line, with nothing after it", () => {
        expect(parse("--sessions--")).toBeNull();
    });
});

describe("the in-flight review lists", () => {
    test("are optional: an older Shepherd without them still yields a snapshot", () => {
        // These routes joined the read scope after 1.47.0. An instance older
        // than that answers 403, which poll.sh prints as null.
        const out = parse(
            output({ "--reviews-inflight--": "null", "--plan-gates-inflight--": "null" }),
        );
        expect(out).not.toBeNull();
        expect(out.inReview).toEqual([]);
    });

    test("are optional even when missing entirely", () => {
        const out = parse(
            output({ "--reviews-inflight--": undefined, "--plan-gates-inflight--": undefined }),
        );
        expect(out).not.toBeNull();
        expect(out.inReview).toEqual([]);
    });

    test("combine, because either kind of reviewer parks the session", () => {
        // The HUD's own test: reviews.isReviewing(id) || planGates.isReviewing(id).
        const out = parse(
            output({
                "--reviews-inflight--": '["a","b"]',
                "--plan-gates-inflight--": '["b","c"]',
            }),
        );
        expect(out.inReview.sort()).toEqual(["a", "b", "c"]);
    });

    test("still contribute when only one of them is known", () => {
        const out = parse(
            output({ "--reviews-inflight--": '["a"]', "--plan-gates-inflight--": "null" }),
        );
        expect(out.inReview).toEqual(["a"]);
    });
});

describe("a list of session ids", () => {
    test("keeps strings and drops everything else", () => {
        expect(idList('["a", 7, null, "", {"x":1}, "b"]')).toEqual(["a", "b"]);
    });

    test("is empty for null, meaning not known", () => {
        expect(idList("null")).toEqual([]);
    });

    test("is empty for anything that is not a list", () => {
        expect(idList('{"a":1}')).toEqual([]);
        expect(idList("nope")).toEqual([]);
        expect(idList(undefined)).toEqual([]);
    });

    test("drops an id far too long to be one", () => {
        expect(idList(JSON.stringify(["x".repeat(500), "ok"]))).toEqual(["ok"]);
    });

    test("refuses a list with an implausible number of entries", () => {
        const huge = JSON.stringify(Array.from({ length: 6000 }, (_, i) => "id" + i));
        expect(idList(huge)).toEqual([]);
    });
});
