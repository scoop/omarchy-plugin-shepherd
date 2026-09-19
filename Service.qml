import QtQuick
import Quickshell
import Quickshell.Io
import "src/holds.js" as Holds
import "src/rows.js" as Rows
import "src/connection.js" as Conn
import "src/stages.js" as Stages

// The one thing that talks to Shepherd, and the only place this plugin's state
// lives.
//
// Mounted for the life of the shell (keepLoaded), so the hold clocks in
// `_seen` survive the card being opened and closed, the bar being rebuilt, a
// monitor being plugged in, and a theme change. They do not survive a shell
// restart, and the card says so rather than inventing a duration — see
// src/rows.js.
//
// Nothing here is written to disk. The snapshot is worth exactly as much as the
// poll it came from, and a cached one read at startup would be a claim about
// sessions that have had all night to move on.
Item {
    id: root

    // ── injected by the host ──────────────────────────────────────────────────

    property string omarchyPath: ""
    property var shell: null
    property var manifest: null

    // ── pushed down by the Indicator ──────────────────────────────────────────
    //
    // Settings reach bar widgets, not services, so the widget is where
    // configuration enters and this is where it lands.

    property string baseUrl: ""
    property string allowPlaintextFor: ""
    property int pollIntervalSec: 30

    // ── what the Indicator and the Card read ──────────────────────────────────

    /**
     * One of: unconfigured, needs-token, degraded, unreachable, ok.
     *
     * A binding, not something recomputed by hand. It was the latter once, from
     * onBaseUrlChanged, and that is a trap: a change handler can run before the
     * bindings that depend on the same property have re-evaluated, so it read
     * the parse of the *previous* address — for the first push, the empty one —
     * concluded "unconfigured", and never looked again. Derived state that is
     * declared cannot go stale that way.
     */
    readonly property string connection: Conn.stateFrom({
        baseUrlValid: parsedUrl.ok,
        permitted: addressUsable,
        // Optimistic on purpose: only bin/poll.sh can answer this, since it is
        // the only thing that touches the keyring, and it answers by exiting 2
        // — which reads back as a refused credential and lands on needs-token.
        // Assuming a token exists until a poll says otherwise is what keeps the
        // first poll from flashing "sign in" at an operator who is signed in.
        hasToken: true,
        outcome: _outcome
    })

    /** Rows for the card, already tiered, phrased and ordered. */
    property var rows: []

    /** Per-tier counts. Only needsYou is ever put on the bar. */
    property var counts: ({
            needsYou: 0,
            working: 0,
            waiting: 0,
        })

    /** Whether Shepherd has any live session at all, held or not. */
    property bool anySessions: false

    /** Epoch ms of the last poll that came back, 0 if none has. */
    property double lastOkAt: 0

    /** Epoch ms since when we have been out of contact, 0 while in contact. */
    property double unreachableSince: 0

    /** Set while the demo fixture is loaded, so nothing pretends it is real. */
    property bool demoMode: false

    /** The address, parsed and normalised, or an unusable result. */
    readonly property var parsedUrl: Conn.parseBaseUrl(baseUrl)
    readonly property bool addressUsable: parsedUrl.ok && Conn.permitted(parsedUrl, allowPlaintextFor)

    /**
     * True when the address is http:// to somewhere other than this machine and
     * no consent has been recorded for exactly it. The card explains this one
     * rather than just refusing, because the operator can fix it and cannot
     * guess it.
     */
    readonly property bool plaintextRefused: parsedUrl.ok && parsedUrl.plaintext && !addressUsable

    // ── internals ─────────────────────────────────────────────────────────────

    readonly property string _pluginDir: Qt.resolvedUrl(".").toString().replace("file://", "")
    property var _seen: Rows.emptySeen()
    property int _failures: 0
    property string _outcome: "never"

    /**
     * Whether the address may be used, computed rather than read.
     *
     * `addressUsable` is the same question as a binding, and the bindings are
     * what the Indicator and the Card read. But a change handler must not: it
     * can run before the bindings that depend on the same inputs have
     * re-evaluated, so `addressUsable` inside _restart() could still answer for
     * the previous address. parsedUrl is safe there — onParsedUrlChanged fires
     * after it holds its new value — so everything imperative derives from it
     * directly, and only the declarative readers use the property.
     */
    function _usable() {
        return parsedUrl.ok && Conn.permitted(parsedUrl, allowPlaintextFor);
    }

    // parsedUrl rather than baseUrl: it re-evaluates for every address change,
    // including one valid address to another, and by the time it has changed
    // everything derived from it has changed too.
    onParsedUrlChanged: _restart()
    onAllowPlaintextForChanged: _restart()
    onPollIntervalSecChanged: if (!demoMode)
        _schedule()

    Component.onCompleted: _restart()

    /** Start over: new address, new consent, nothing carried across. */
    function _restart() {
        if (demoMode) {
            return;
        }
        // Clocks measured against one Shepherd mean nothing against another.
        _seen = Rows.emptySeen();
        rows = [];
        counts = {
            needsYou: 0,
            working: 0,
            waiting: 0,
        };
        anySessions = false;
        _failures = 0;
        _outcome = "never";
        lastOkAt = 0;
        unreachableSince = 0;
        pollTimer.stop();
        if (_usable()) {
            poll();
        }
    }

    function _schedule() {
        if (demoMode || !_usable()) {
            return;
        }
        pollTimer.interval = Conn.nextDelayMs(pollIntervalSec, _failures);
        pollTimer.restart();
    }

    /** Ask Shepherd, unless we are already asking. */
    function poll() {
        if (demoMode || !_usable() || poller.running) {
            return;
        }
        // The account the credential is filed under is the address itself, so
        // pointing the plugin somewhere else never reuses the old token.
        poller.stdinPayload = JSON.stringify({
            url: parsedUrl.url,
            account: parsedUrl.url,
        });
        poller.running = true;
    }

    BoundedProcess {
        id: poller

        program: [root._pluginDir + "bin/poll.sh"]

        // Three requests at up to fifteen seconds each, plus the keyring
        // lookup, with room to spare. supervise.sh enforces it on the group.
        deadlineSeconds: 55

        // Two bodies of up to two megabytes each is what the helper permits;
        // this is the shell's own ceiling on top of that.
        maxBytes: 4500000

        onFinishedWith: function (text, code, tooLarge) {
            if (tooLarge) {
                // A herd big enough to overrun this is a herd something else is
                // wrong with. Refuse the answer rather than render half of it.
                root._fail("malformed");
                return;
            }
            if (code !== 0) {
                // The exit code and nothing else: enough to tell a revoked
                // token from a dead tailnet in a log, with nothing from
                // Shepherd in it.
                console.warn("scoop.shepherd: poll failed, exit " + code);
                root._fail(Conn.outcomeFromExit(code));
                return;
            }
            root._ingest(text);
        }
    }

    Timer {
        id: pollTimer
        repeat: false
        onTriggered: root.poll()
    }

    /**
     * A poll that did not come back with an answer.
     *
     * The rows are cleared, not kept. A stale "2 need you" is a lie that costs
     * a context switch, and the whole promise of the number is that it is never
     * a number we are not currently sure of.
     */
    function _fail(outcome) {
        _outcome = outcome;
        _failures = _failures + 1;
        rows = [];
        counts = {
            needsYou: 0,
            working: 0,
            waiting: 0,
        };
        anySessions = false;
        if (unreachableSince === 0) {
            unreachableSince = Date.now();
        }
        _schedule();
    }

    /** Parse what the helper printed, and fold it into the view. */
    function _ingest(text) {
        var parsed = _parseBodies(text);
        if (!parsed) {
            _fail("malformed");
            return;
        }
        _apply(parsed.sessions, parsed.holds, parsed.git);
        _outcome = "ok";
        _failures = 0;
        lastOkAt = Date.now();
        unreachableSince = 0;
        _schedule();
    }

    /**
     * Split the helper's output into its two bodies.
     *
     * The markers are on lines of their own and the bodies are single-line JSON
     * as Shepherd serialises it, so this is a split rather than a parse. A
     * malformed answer returns null and is treated as no answer at all — a
     * half-read snapshot would show a count derived from part of the herd.
     */
    function _parseBodies(text) {
        var head = "--sessions--\n";
        var midHolds = "\n--holds--\n";
        var midGit = "\n--git--\n";
        if (text.indexOf(head) !== 0) {
            return null;
        }
        var rest = text.slice(head.length);
        var cutHolds = rest.indexOf(midHolds);
        if (cutHolds < 0) {
            return null;
        }
        var afterHolds = rest.slice(cutHolds + midHolds.length);
        var cutGit = afterHolds.indexOf(midGit);
        if (cutGit < 0) {
            return null;
        }
        try {
            var sessions = JSON.parse(rest.slice(0, cutHolds));
            var holds = JSON.parse(afterHolds.slice(0, cutGit));
            var git = JSON.parse(afterHolds.slice(cutGit + midGit.length));
            if (!Array.isArray(sessions) || !holds || typeof holds !== "object" || !git || typeof git !== "object") {
                return null;
            }
            return {
                sessions: sessions,
                holds: holds,
                git: git
            };
        } catch (e) {
            return null;
        }
    }

    function _apply(sessions, holds, git) {
        var built = Rows.build({
            sessions: sessions,
            holds: holds,
            git: git || {}
        }, _seen, Date.now(), Holds.describe, Stages.isYourTurn);
        _seen = built.seen;
        rows = built.rows;
        counts = built.counts;
        anySessions = sessions.length > 0;
    }

    /** The oldest row that needs the operator, for the tooltip. */
    function firstNeedsYou() {
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].tier === "needs-you") {
                return rows[i];
            }
        }
        return null;
    }

    /** How long a row has been held, or "" when that is not honestly known. */
    function ageOf(row) {
        return Rows.ageOf(row, Date.now());
    }

    // ── demo ──────────────────────────────────────────────────────────────────
    //
    // The honest screenshot of this plugin on a good day is an empty bar, and
    // the marketplace wants a preview image. This loads a fixture so the card
    // can be photographed, and so the layout can be worked on without three
    // agents conveniently stuck.

    BoundedProcess {
        id: demoReader
        // Through the bounded reader, not cat: the fixture lives in a
        // directory anything running as this user can write to, so the name
        // could be a symlink to somewhere else or a FIFO that never answers.
        // The helper emits at most maxBytes + 1 so an overflow is detected
        // here rather than truncated into something that parses.
        program: [root._pluginDir + "bin/read-bounded.sh", "262144", root._pluginDir + "demo/snapshot.json"]
        deadlineSeconds: 5
        maxBytes: 262144
        onFinishedWith: function (text, code, tooLarge) {
            if (code !== 0 || tooLarge) {
                return;
            }
            try {
                var fixture = JSON.parse(text);
                root.demoMode = true;
                pollTimer.stop();
                root._seen = Rows.emptySeen();
                root._apply(fixture.sessions || [], fixture.holds || {}, fixture.git || {});
                root._outcome = "ok";
                root.lastOkAt = Date.now();
                root.unreachableSince = 0;
                root._outcome = "ok";
            } catch (e) {
                // A broken fixture is a broken fixture; the live view is
                // untouched because nothing above ran.
            }
        }
    }

    // Reachable with nobody present, so nothing here discloses anything from
    // Shepherd, changes anything on Shepherd, or writes anything down. `status`
    // answers with our own view of the connection and not a single session.
    IpcHandler {
        target: "scoop.shepherd.service"

        function refresh(): void {
            if (root.demoMode) {
                root.demoMode = false;
                root._restart();
                return;
            }
            root.poll();
        }

        function status(): string {
            return root.connection;
        }

        function demo(): void {
            if (!demoReader.running) {
                demoReader.running = true;
            }
        }
    }
}
