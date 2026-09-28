import { describe, expect, test } from "bun:test";
import { appLink, hasAppHandler, APP_SCHEME } from "../src/links.js";

describe("the link handed to an installed Shepherd app", () => {
    test("names the session under the web+shepherd scheme", () => {
        expect(APP_SCHEME).toBe("web+shepherd");
        expect(appLink("abc-123")).toBe("web+shepherd://session/abc-123");
    });

    test.each([
        ["a/b", "web+shepherd://session/a%2Fb"],
        ["a?b#c", "web+shepherd://session/a%3Fb%23c"],
        ["a b", "web+shepherd://session/a%20b"],
        ["ä", "web+shepherd://session/%C3%A4"],
    ])("percent-encodes %p so it stays one path segment", (id, link) => {
        expect(appLink(id)).toBe(link);
    });

    test("cannot begin with a dash, so xdg-open never reads it as an option", () => {
        expect(appLink("-x").startsWith("-")).toBe(false);
    });
});

describe("whether xdg-mime named a handler", () => {
    test("a desktop file on exit 0 is a handler", () => {
        expect(hasAppHandler("chrome-abcdef-Default.desktop\n", 0)).toBe(true);
    });

    test("nothing registered prints nothing", () => {
        expect(hasAppHandler("", 0)).toBe(false);
        expect(hasAppHandler("\n", 0)).toBe(false);
    });

    test("a failed query is not a handler, whatever it printed", () => {
        expect(hasAppHandler("chrome-abcdef-Default.desktop\n", 1)).toBe(false);
    });

    test.each(["not a desktop file", "a.desktop\nb.desktop", "a.desktop.bak"])(
        "rejects %p",
        (text) => {
            expect(hasAppHandler(text, 0)).toBe(false);
        },
    );

    test("a missing reading is not a handler", () => {
        expect(hasAppHandler(undefined, 0)).toBe(false);
    });
});
