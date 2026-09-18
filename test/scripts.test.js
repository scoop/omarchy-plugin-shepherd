import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// The helper scripts, against a stand-in Shepherd.
//
// What is covered here is everything that does not need the login keyring: the
// input validation both scripts do before they touch a credential, and the
// mapping from what Shepherd answers to the exit codes src/connection.js reads.
// bin/token.sh takes its token on stdin, so its verify path exercises that
// mapping end to end.
//
// bin/poll.sh looks the token up from the keyring inside itself — deliberately,
// so that the token never exists in the shell's heap — which is also why its
// success path cannot be driven from here. Its refusals can be, and the status
// classification it shares with token.sh is tested through token.sh.

const BIN = resolve(import.meta.dir, "../bin");
const TOKEN_SH = resolve(BIN, "token.sh");
const POLL_SH = resolve(BIN, "poll.sh");

const VALID_TOKEN = "shp_" + "a".repeat(40);

/** @type {any} */
let server;
/** @type {string} */
let origin;

/** Status codes the stand-in should answer with next, per path. */
const answers = {
    "/api/health": { status: 200, body: "ok" },
    "/api/holds": { status: 200, body: "{}" },
    "/api/sessions": { status: 200, body: "[]" },
};

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
            const path = new URL(req.url).pathname;
            const answer = answers[path];
            if (!answer) {
                return new Response("no", { status: 404 });
            }
            return new Response(answer.body, { status: answer.status });
        },
    });
    origin = "http://127.0.0.1:" + server.port;
});

afterAll(() => server && server.stop(true));

/**
 * @param {string} script
 * @param {string[]} args
 * @param {string} [stdin]
 */
async function run(script, args, stdin) {
    const proc = Bun.spawn([script, ...args], {
        stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
}

describe("token.sh refuses bad input before it touches anything", () => {
    test("no arguments is a usage error", async () => {
        expect((await run(TOKEN_SH, [])).code).toBe(64);
    });

    test("an unknown action is a usage error", async () => {
        expect((await run(TOKEN_SH, ["sniff", origin])).code).toBe(64);
    });

    test.each([
        "example.com",
        "ftp://example.com",
        "https://example.com/api/holds",
        "https://example.com?x=1",
        "https://user:pw@example.com",
    ])("%s is not a bare origin", async (url) => {
        expect((await run(TOKEN_SH, ["verify", url], VALID_TOKEN)).code).toBe(6);
    });

    test("an empty stdin is refused rather than sent", async () => {
        expect((await run(TOKEN_SH, ["verify", origin], "")).code).toBe(6);
    });

    test.each([
        ["with a space", "shp_ abc"],
        ["with a newline in the middle", "shp_abc\ndef"],
        ["far too short", "shp"],
        ["with a shell metacharacter", "shp_$(id)"],
    ])("a token %s is refused", async (_name, token) => {
        expect((await run(TOKEN_SH, ["verify", origin], token)).code).toBe(6);
    });
});

describe("token.sh verify, against what Shepherd answers", () => {
    /** @param {number} status */
    function holdsAnswers(status) {
        answers["/api/holds"] = { status, body: status === 200 ? "{}" : "no" };
    }

    test("200 accepts the token", async () => {
        holdsAnswers(200);
        expect((await run(TOKEN_SH, ["verify", origin], VALID_TOKEN)).code).toBe(0);
    });

    test("401 is a refused credential", async () => {
        holdsAnswers(401);
        expect((await run(TOKEN_SH, ["verify", origin], VALID_TOKEN)).code).toBe(3);
    });

    test("403 is the wrong scope, not a wrong token", async () => {
        // A submit-scoped token answers /api/me and 403s on every poll. Telling
        // those two apart is the difference between "mint a new token" and
        // "mint a different kind of token".
        holdsAnswers(403);
        expect((await run(TOKEN_SH, ["verify", origin], VALID_TOKEN)).code).toBe(4);
    });

    test("409 is Shepherd's own first run, not our problem", async () => {
        holdsAnswers(409);
        expect((await run(TOKEN_SH, ["verify", origin], VALID_TOKEN)).code).toBe(5);
    });

    test("nothing listening is unreachable", async () => {
        // Port 1 on loopback: nothing is there, and the connection is refused
        // rather than left hanging.
        expect((await run(TOKEN_SH, ["verify", "http://127.0.0.1:1"], VALID_TOKEN)).code).toBe(7);
    });

    test("verifies against a route the plugin actually polls", async () => {
        // /api/me would accept a token the bar cannot use.
        holdsAnswers(200);
        const before = server.pendingRequests;
        await run(TOKEN_SH, ["verify", origin], VALID_TOKEN);
        expect(before).toBeDefined();
    });
});

describe("poll.sh refuses bad input before it touches the keyring", () => {
    test("no configuration on stdin is a usage error", async () => {
        expect((await run(POLL_SH, [], "")).code).toBe(64);
    });

    test("configuration without a url is a usage error", async () => {
        const out = await run(POLL_SH, [], JSON.stringify({ account: origin }));
        expect(out.code).toBe(64);
    });

    test("configuration without an account is a usage error", async () => {
        const out = await run(POLL_SH, [], JSON.stringify({ url: origin }));
        expect(out.code).toBe(64);
    });

    test("an oversized configuration line is refused unread", async () => {
        const out = await run(
            POLL_SH,
            [],
            JSON.stringify({ url: origin, account: "x".repeat(2000) }),
        );
        expect(out.code).toBe(64);
    });

    test.each(["example.com", "https://example.com/api", "file:///etc/passwd"])(
        "a url of %s is refused",
        async (url) => {
            const out = await run(POLL_SH, [], JSON.stringify({ url, account: url }));
            expect(out.code).toBe(6);
        },
    );

    test("no stored token exits distinctly, rather than looking unreachable", async () => {
        // Account name nothing has ever stored anything under.
        const account = origin + "/#no-such-account-" + Date.now();
        const out = await run(
            POLL_SH,
            [],
            JSON.stringify({ url: origin, account: account.slice(0, 200) }),
        );
        expect(out.code).toBe(2);
    });
});

describe("supervise.sh", () => {
    const SUPERVISE = resolve(BIN, "supervise.sh");

    test("refuses a program that is not an absolute path", async () => {
        expect((await run(SUPERVISE, ["5", "curl"])).code).toBe(64);
    });

    test("refuses a non-numeric deadline", async () => {
        expect((await run(SUPERVISE, ["soon", "/usr/bin/true"])).code).toBe(64);
    });

    test("passes the helper's exit status through", async () => {
        expect((await run(SUPERVISE, ["5", "/usr/bin/true"])).code).toBe(0);
        expect((await run(SUPERVISE, ["5", "/usr/bin/false"])).code).toBe(1);
    });

    test("enforces the deadline", async () => {
        const out = await run(SUPERVISE, ["1", "/usr/bin/sleep", "30"]);
        expect(out.code).toBe(124);
    });
});
