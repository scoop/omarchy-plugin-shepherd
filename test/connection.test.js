import { describe, expect, test } from "bun:test";
import {
    isLoopback,
    parseBaseUrl,
    permitted,
    stateFrom,
    outcomeFromExit,
    nextDelayMs,
} from "../src/connection.js";

describe("parsing an address", () => {
    test.each([
        ["https://shepherd.tail1234.ts.net", "https://shepherd.tail1234.ts.net"],
        ["https://shepherd.tail1234.ts.net/", "https://shepherd.tail1234.ts.net"],
        ["http://127.0.0.1:7330", "http://127.0.0.1:7330"],
        ["  https://Shepherd.Example.COM  ", "https://shepherd.example.com"],
    ])("%s normalises to %s", (raw, expected) => {
        const p = parseBaseUrl(raw);
        expect(p.ok).toBe(true);
        expect(p.url).toBe(expected);
    });

    test.each([
        ["", "empty"],
        ["   ", "empty"],
        ["shepherd.example.com", "malformed"],
        ["ftp://shepherd.example.com", "malformed"],
        ["file:///etc/passwd", "malformed"],
        ["https://example.com/api/sessions", "malformed"],
        ["https://example.com?x=1", "malformed"],
        ["https://example.com#x", "malformed"],
        ["https://user:pw@example.com", "malformed"],
        ["https://example.com:99999", "malformed"],
        ["https://example.com:abc", "malformed"],
        ["https://exa mple.com", "malformed"],
    ])("%s is refused as %s", (raw, reason) => {
        const p = parseBaseUrl(raw);
        expect(p.ok).toBe(false);
        expect(p.reason).toBe(reason);
    });

    test("refuses an absurdly long value rather than working on it", () => {
        expect(parseBaseUrl("https://" + "a".repeat(400) + ".com").reason).toBe("too-long");
    });

    test("keeps the port", () => {
        expect(parseBaseUrl("https://example.com:8443").url).toBe("https://example.com:8443");
    });
});

describe("what counts as this machine", () => {
    test.each(["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "LOCALHOST"])(
        "%s is loopback",
        (host) => {
            expect(isLoopback(host)).toBe(true);
        },
    );

    test.each(["example.com", "192.168.1.10", "10.0.0.1", "0.0.0.0", "127.0.0.1.example.com"])(
        "%s is not loopback",
        (host) => {
            expect(isLoopback(host)).toBe(false);
        },
    );
});

describe("plaintext consent", () => {
    test("https needs no consent", () => {
        expect(permitted(parseBaseUrl("https://example.com"), "")).toBe(true);
    });

    test("http to this machine needs no consent", () => {
        // Shepherd binds 127.0.0.1 by default. Asking here would teach the
        // operator to say yes without reading.
        expect(permitted(parseBaseUrl("http://127.0.0.1:7330"), "")).toBe(true);
    });

    test("http to anywhere else is refused without it", () => {
        expect(permitted(parseBaseUrl("http://192.168.1.10:7330"), "")).toBe(false);
    });

    test("is granted for one exact address", () => {
        const p = parseBaseUrl("http://192.168.1.10:7330");
        expect(permitted(p, "http://192.168.1.10:7330")).toBe(true);
    });

    test("does not carry to a different host", () => {
        const p = parseBaseUrl("http://192.168.1.99:7330");
        expect(permitted(p, "http://192.168.1.10:7330")).toBe(false);
    });

    test("does not carry to a different port on the same host", () => {
        const p = parseBaseUrl("http://192.168.1.10:9999");
        expect(permitted(p, "http://192.168.1.10:7330")).toBe(false);
    });

    test("withdraws itself when the address changes, with nobody having to notice", () => {
        // This is the whole reason consent is stored as an address rather than
        // as a flag: there is no bookkeeping step that can be forgotten.
        const consent = "http://192.168.1.10:7330";
        expect(permitted(parseBaseUrl(consent), consent)).toBe(true);
        expect(permitted(parseBaseUrl("http://elsewhere.local:7330"), consent)).toBe(false);
    });

    test("never applies to an address that did not parse", () => {
        expect(permitted(parseBaseUrl("nonsense"), "nonsense")).toBe(false);
    });
});

describe("our view of Shepherd", () => {
    const base = { baseUrlValid: true, permitted: true, hasToken: true, outcome: "ok" };

    test("is unconfigured before an address is set", () => {
        expect(stateFrom({ ...base, baseUrlValid: false })).toBe("unconfigured");
    });

    test("is needs-token when nothing is in the keyring", () => {
        expect(stateFrom({ ...base, hasToken: false })).toBe("needs-token");
    });

    test("is needs-token when the credential was refused", () => {
        // Distinct from unreachable on purpose: this one never resolves itself.
        expect(stateFrom({ ...base, outcome: "unauthorized" })).toBe("needs-token");
    });

    test("is degraded when the token lacks the scope we need", () => {
        expect(stateFrom({ ...base, outcome: "forbidden" })).toBe("degraded");
    });

    test("is degraded when Shepherd has not finished its own first run", () => {
        expect(stateFrom({ ...base, outcome: "first-run" })).toBe("degraded");
    });

    test("is degraded when we refuse to use the address unencrypted", () => {
        expect(stateFrom({ ...base, permitted: false })).toBe("degraded");
    });

    test.each(["unreachable", "timeout", "malformed", "never"])(
        "is unreachable after %s",
        (outcome) => {
            expect(stateFrom({ ...base, outcome })).toBe("unreachable");
        },
    );

    test("is ok only when a poll actually came back", () => {
        expect(stateFrom(base)).toBe("ok");
    });

    test("puts configuration ahead of any stale outcome", () => {
        // Clearing the address must empty the bar, not leave the last error on it.
        expect(stateFrom({ ...base, baseUrlValid: false, outcome: "unauthorized" })).toBe(
            "unconfigured",
        );
    });
});

describe("reading the helper's exit code", () => {
    test.each([
        [0, "ok"],
        [3, "unauthorized"],
        [4, "forbidden"],
        [5, "first-run"],
        [6, "malformed"],
        [7, "unreachable"],
        [124, "timeout"],
        [1, "unreachable"],
        [64, "unreachable"],
    ])("exit %i is %s", (code, outcome) => {
        expect(outcomeFromExit(code)).toBe(outcome);
    });
});

describe("when to poll again", () => {
    test("holds the configured interval while Shepherd answers", () => {
        expect(nextDelayMs(30, 0)).toBe(30000);
    });

    test("doubles while it does not", () => {
        expect(nextDelayMs(30, 1)).toBe(60000);
        expect(nextDelayMs(30, 2)).toBe(120000);
    });

    test("stops growing at five minutes, and never stops asking", () => {
        // Off the tailnet there is no signal that the way back has opened, so
        // the only route home is to keep asking — cheaply.
        expect(nextDelayMs(30, 20)).toBe(300000);
        expect(nextDelayMs(600, 20)).toBe(300000);
    });

    test("clamps an interval outside the schema's range", () => {
        expect(nextDelayMs(1, 0)).toBe(15000);
        expect(nextDelayMs(99999, 0)).toBe(600000);
        expect(nextDelayMs(undefined, 0)).toBe(30000);
    });
});
