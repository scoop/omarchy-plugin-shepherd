import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui

// The list behind the number.
//
// Needs-you first and oldest-first within it, because the thing that has been
// stuck longest is the thing most likely to have been forgotten. Working and
// waiting follow in their own sections, quieter, so that reading them is a
// choice rather than something the eye has to filter out.
//
// Every row opens the same place: Shepherd's own view of that session. This
// plugin holds a read-scoped token and cannot approve, merge or steer anything,
// so a row that offered to would be lying; and one destination you can learn
// beats a destination that depends on which hold a row happens to carry.
Item {
    id: root

    property string omarchyPath: ""
    property var shell: null
    property var manifest: null
    // Injected by the host for plugins that pair a UI with a service.
    property var service: null

    property bool opened: false
    property int selectedIndex: 0

    readonly property var rows: service && service.rows ? service.rows : []
    readonly property string connection: service ? service.connection : "unconfigured"
    readonly property bool needsSetup: connection === "needs-token" || connection === "degraded"

    readonly property color foreground: Color.menu.text
    readonly property color dim: Qt.darker(Color.menu.text, 1.4)
    readonly property string fontFamily: Style.font.menuFamily

    // Clock for the ages on the rows. A held session's age is the one thing in
    // the card that changes without a poll, and a minute is as precise as the
    // shortest form it is rendered in.
    property double nowMs: Date.now()

    Timer {
        interval: 30000
        repeat: true
        running: root.opened
        onTriggered: root.nowMs = Date.now()
    }

    function open(payloadJson) {
        opened = true;
        nowMs = Date.now();
        selectedIndex = 0;
        Qt.callLater(function () {
            if (root.needsSetup) {
                tokenField.forceActiveFocus();
            } else {
                keyCatcher.forceActiveFocus();
            }
        });
    }

    function close() {
        opened = false;
        tokenField.text = "";
        setupNote.text = "";
    }

    function ageOf(row) {
        if (!row.ageExact || row.heldSince === null) {
            return "";
        }
        var ms = nowMs - row.heldSince;
        if (ms < 0) {
            return "";
        }
        var s = Math.floor(ms / 1000);
        if (s < 60) {
            return s + "s";
        }
        var m = Math.floor(s / 60);
        if (m < 60) {
            return m + "m";
        }
        var h = Math.floor(m / 60);
        return h < 24 ? h + "h" : Math.floor(h / 24) + "d";
    }

    /** Open Shepherd's own view of one session, in the browser. */
    function openSession(row) {
        if (!service || !service.parsedUrl || !service.parsedUrl.ok || !row) {
            return;
        }
        // argv, not a shell string: the id comes from Shepherd and the URL from
        // settings, and neither gets to be reinterpreted by a shell on the way.
        Quickshell.execDetached(["/usr/bin/xdg-open", service.parsedUrl.url + "/?session=" + encodeURIComponent(row.id)]);
        close();
    }

    function moveSelection(step) {
        if (rows.length === 0) {
            return;
        }
        var next = selectedIndex + step;
        if (next < 0) {
            next = 0;
        }
        if (next > rows.length - 1) {
            next = rows.length - 1;
        }
        selectedIndex = next;
    }

    /** The index at which a tier's section starts, or -1 if it is empty. */
    function sectionStart(tier) {
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].tier === tier) {
                return i;
            }
        }
        return -1;
    }

    PanelWindow {
        id: panel
        visible: root.opened
        anchors {
            top: true
            bottom: true
            left: true
            right: true
        }
        color: "transparent"
        WlrLayershell.namespace: "scoop-shepherd"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
        exclusionMode: ExclusionMode.Ignore

        Rectangle {
            anchors.fill: parent
            color: Color.menu.scrim
        }

        MouseArea {
            anchors.fill: parent
            onClicked: root.close()
        }

        BorderSurface {
            id: card
            // A card, not a takeover: this holds a short list of short lines,
            // and a full-screen surface for it would be mostly empty.
            width: Math.min(Style.space(420), panel.width - Style.space(40))
            height: Math.min(content.implicitHeight + Style.space(32), panel.height - Style.space(40))
            radius: Style.space(12)
            anchors.centerIn: parent
            color: Color.menu.background
            borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))

            // Swallow clicks so they do not reach the dismiss area behind.
            MouseArea {
                anchors.fill: parent
                onClicked: {}
            }

            // The key catcher must be an ancestor of everything it is meant to
            // catch for: Keys.priority: Keys.BeforeItem preempts descendants
            // only, so a sibling layout leaves the card deaf.
            PanelKeyCatcher {
                id: keyCatcher
                anchors.fill: parent
                blocked: root.needsSetup
                onCloseRequested: root.close()

                Keys.onPressed: function (event) {
                    if (root.needsSetup) {
                        return;
                    }
                    if (event.key === Qt.Key_J || event.key === Qt.Key_Down) {
                        root.moveSelection(1);
                        event.accepted = true;
                    } else if (event.key === Qt.Key_K || event.key === Qt.Key_Up) {
                        root.moveSelection(-1);
                        event.accepted = true;
                    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                        if (root.rows.length > root.selectedIndex) {
                            root.openSession(root.rows[root.selectedIndex]);
                        }
                        event.accepted = true;
                    }
                }

                Column {
                    id: content
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: Style.space(16)
                    spacing: Style.spacing.sm

                    // ── header ────────────────────────────────────────────────

                    Row {
                        width: parent.width
                        spacing: Style.spacing.sm

                        Text {
                            text: "Shepherd"
                            color: root.foreground
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.body
                            font.bold: true
                            textFormat: Text.PlainText
                        }

                        Text {
                            text: root.service && root.service.demoMode ? "demo data" : ""
                            color: root.dim
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.body
                            textFormat: Text.PlainText
                        }
                    }

                    // ── sign-in ───────────────────────────────────────────────

                    Column {
                        width: parent.width
                        spacing: Style.spacing.xs
                        visible: root.needsSetup

                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            color: root.dim
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.body
                            textFormat: Text.PlainText
                            text: {
                                if (root.service && root.service.plaintextRefused) {
                                    return "This address is plain http:// to another machine, so the token would cross the network in clear. Grant consent for exactly it with:\n\nomarchy bar set scoop.shepherd allowPlaintextFor '" + (root.service.parsedUrl ? root.service.parsedUrl.url : "") + "'";
                                }
                                if (root.connection === "degraded") {
                                    return "Shepherd answered, but the stored token cannot read it. Mint one with the 'read' scope in Shepherd under Settings → Access, and paste it here.";
                                }
                                return "Paste an access token with the 'read' scope. Mint it in Shepherd under Settings → Access — the plaintext is shown once.";
                            }
                        }

                        TextField {
                            id: tokenField
                            width: parent.width
                            visible: !(root.service && root.service.plaintextRefused)
                            echoMode: TextInput.Password
                            placeholderText: "Access token"
                            onAccepted: root.storeToken()
                        }

                        Text {
                            id: setupNote
                            width: parent.width
                            wrapMode: Text.WordWrap
                            visible: text !== ""
                            color: root.dim
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.body
                            textFormat: Text.PlainText
                            text: ""
                        }

                        PanelActionButton {
                            visible: !(root.service && root.service.plaintextRefused)
                            text: "Sign in"
                            onClicked: root.storeToken()
                        }
                    }

                    // ── the list ──────────────────────────────────────────────

                    Text {
                        width: parent.width
                        visible: !root.needsSetup && root.rows.length === 0
                        wrapMode: Text.WordWrap
                        color: root.dim
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                        textFormat: Text.PlainText
                        text: root.connection === "unreachable" ? "Shepherd is unreachable." : "Nothing is held. Every session is running or idle."
                    }

                    Repeater {
                        model: root.needsSetup ? [] : root.rows

                        delegate: Column {
                            required property int index
                            required property var modelData

                            width: content.width

                            // A heading appears above the first row of each
                            // tier, so the sections are visible without the
                            // rows having to be grouped into separate models.
                            PanelSectionHeader {
                                width: parent.width
                                visible: parent.index === root.sectionStart(parent.modelData.tier)
                                text: {
                                    if (parent.modelData.tier === "needs-you") {
                                        return "Needs you";
                                    }
                                    if (parent.modelData.tier === "working") {
                                        return "Being worked";
                                    }
                                    return "Waiting on a reset";
                                }
                            }

                            Rectangle {
                                width: parent.width
                                height: rowLine.implicitHeight + Style.space(10)
                                radius: Style.space(6)
                                color: root.selectedIndex === parent.index ? Color.menu.selectedBackground : "transparent"

                                Row {
                                    id: rowLine
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.leftMargin: Style.space(8)
                                    anchors.rightMargin: Style.space(8)
                                    spacing: Style.spacing.sm

                                    Text {
                                        text: modelData.label
                                        color: modelData.tier === "needs-you" ? root.foreground : root.dim
                                        font.family: root.fontFamily
                                        font.pixelSize: Style.font.body
                                        textFormat: Text.PlainText
                                    }

                                    Text {
                                        text: modelData.phrase
                                        color: root.dim
                                        font.family: root.fontFamily
                                        font.pixelSize: Style.font.body
                                        textFormat: Text.PlainText
                                    }

                                    Text {
                                        text: root.ageOf(modelData)
                                        color: root.dim
                                        font.family: root.fontFamily
                                        font.pixelSize: Style.font.body
                                        textFormat: Text.PlainText
                                    }

                                    Text {
                                        text: modelData.repo
                                        color: root.dim
                                        font.family: root.fontFamily
                                        font.pixelSize: Style.font.body
                                        textFormat: Text.PlainText
                                    }
                                }

                                MouseArea {
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    onEntered: root.selectedIndex = parent.parent.index
                                    onClicked: root.openSession(parent.parent.modelData)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── storing a token ───────────────────────────────────────────────────────

    /**
     * Hand the pasted token to bin/token.sh, which verifies it against Shepherd
     * before it writes anything to the keyring.
     *
     * The token goes on stdin and the field is cleared the moment it has been
     * handed over. It is never an argument: argv is world-readable through
     * /proc for every process this user runs.
     */
    function storeToken() {
        if (!service || !service.parsedUrl || !service.parsedUrl.ok) {
            setupNote.text = "No address is configured.";
            return;
        }
        if (tokenField.text === "") {
            return;
        }
        setupNote.text = "Checking…";
        storeProc.stdinPayload = tokenField.text;
        tokenField.text = "";
        storeProc.running = true;
    }

    BoundedProcess {
        id: storeProc
        program: [Qt.resolvedUrl("bin/token.sh").toString().replace("file://", ""), "store", root.service && root.service.parsedUrl ? root.service.parsedUrl.url : ""]
        deadlineSeconds: 25
        maxBytes: 8192

        onFinishedWith: function (text, code, tooLarge) {
            storeProc.stdinPayload = "";
            switch (code) {
                case 0:
                    setupNote.text = "";
                    if (root.service) {
                        root.service.poll();
                    }
                    root.close();
                    break;
                case 3:
                case 2:
                    setupNote.text = "Shepherd refused that token.";
                    break;
                case 4:
                    setupNote.text = "That token does not carry the 'read' scope.";
                    break;
                case 5:
                    setupNote.text = "Shepherd has not finished its own first-run setup.";
                    break;
                case 6:
                    setupNote.text = "That did not look like an access token.";
                    break;
                default:
                    setupNote.text = "Could not reach Shepherd to check it.";
                    break;
            }
        }
    }
}
