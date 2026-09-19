import QtQuick
import qs.Commons
import qs.Ui

// The bar presence.
//
// The number is a promise: this many things stop until I act. Nothing else is
// allowed to put a number here — not the sessions an agent is already working
// through, not the ones waiting for a usage window to reset. Those are in the
// card, one click away, where reading them is a choice.
//
// Absent entirely when no address is configured. A dim mark when Shepherd is
// reachable and running sessions but none of them need anything, because that
// mark is the only way to open the card, and the card is where the other two
// tiers and the sign-in live. A count when one does.
//
// It never shows a number it is not currently sure of: a poll that fails clears
// the rows rather than leaving yesterday's count on the bar.
BarWidget {
    id: root

    // The host injects settings into bar widgets but not into services, so this
    // is where configuration enters and gets pushed down.
    property var service: bar && bar.shell ? bar.shell.serviceFor("scoop.shepherd") : null

    readonly property string connection: service ? service.connection : "unconfigured"
    readonly property int needsYou: service && service.counts ? service.counts.needsYou : 0
    readonly property bool anySessions: service ? service.anySessions : false

    // The three things the bar can be.
    readonly property bool counting: connection === "ok" && needsYou > 0
    readonly property bool marking: connection === "ok" && needsYou === 0 && anySessions
    readonly property bool warning: connection === "unreachable" || connection === "needs-token" || connection === "degraded"

    readonly property bool showing: counting || marking || warning

    // The bar's widget list has zero spacing, so every widget pads itself. 14
    // puts a lone glyph in a slot the size of the icon widgets beside it.
    readonly property int slotPadding: Style.space(14)

    implicitWidth: showing ? (vertical ? barSize : content.implicitWidth + slotPadding) : 0
    implicitHeight: showing ? (vertical ? content.implicitHeight + slotPadding : barSize) : 0
    visible: showing

    // One tone for the whole widget: the glyph and the count must never
    // disagree about how much of your attention this deserves.
    readonly property color tone: {
        if (counting) {
            return Color.urgent;
        }
        if (connection === "needs-token" || connection === "degraded") {
            return Color.urgent;
        }
        return Color.muted;
    }

    readonly property string glyph: {
        if (connection === "unreachable") {
            // We are not saying anything broke. We are saying we no longer know.
            return "";
        }
        if (connection === "needs-token" || connection === "degraded") {
            return "";
        }
        if (counting) {
            return "";
        }
        // Reachable, sessions running, nothing waiting on you: a mark small
        // enough to ignore and large enough to click.
        return "";
    }

    function pushSettings() {
        if (!service) {
            return;
        }
        service.baseUrl = setting("baseUrl", "");
        service.allowPlaintextFor = setting("allowPlaintextFor", "");
        service.pollIntervalSec = setting("pollIntervalSec", 30);
    }

    // The host injects the service with Qt.callLater, so it is null for at
    // least one turn of the event loop on every shell start, theme change,
    // monitor hotplug and settings edit. Every path that reads it tolerates
    // that, and the default while it is null is the quiet state, never the
    // alarm one.
    onSettingsChanged: pushSettings()
    onServiceChanged: pushSettings()
    Component.onCompleted: pushSettings()

    // No IPC here. The widget's only job is to be looked at, and a method that
    // answered with the count would read out state derived from a remote server
    // to any process that can reach omarchy-shell, with nobody present to agree
    // to it.

    /**
     * Make a string safe for the bar's tooltip.
     *
     * The tooltip is rendered by the shell, not by this plugin, so there is no
     * textFormat to pin: it is AutoText, and Qt renders anything that looks
     * like markup as rich text — which loads <img src="..."> from wherever the
     * string says. A session name is an issue title, so it is exactly the kind
     * of string that decides that. src/rows.js already strips control
     * characters; the angle brackets and ampersand have to go too, because
     * only this side knows the value is about to cross into a sink it cannot
     * configure.
     */
    function plain(value) {
        if (typeof value !== "string") {
            return "";
        }
        var out = value.replace(/[<>&]/g, " ");
        // eslint-disable-next-line no-control-regex
        out = out.replace(/[\u0000-\u001f\u007f]+/g, " ");
        return out.length > 120 ? out.slice(0, 119) + "\u2026" : out;
    }

    function tooltipText() {
        if (connection === "needs-token") {
            return "Shepherd — click to sign in";
        }
        if (connection === "degraded") {
            if (service && service.plaintextRefused) {
                return "Shepherd — refusing to send a token over plaintext HTTP";
            }
            return "Shepherd — the stored token cannot read this instance";
        }
        if (connection === "unreachable") {
            var since = service && service.unreachableSince > 0 ? _clock(service.unreachableSince) : "";
            return since !== "" ? "Shepherd unreachable since " + since : "Shepherd unreachable";
        }
        if (needsYou === 0) {
            var live = service && service.counts ? service.counts.working + service.counts.waiting : 0;
            return live > 0 ? "Shepherd — nothing needs you (" + live + " in flight)" : "Shepherd — nothing needs you";
        }
        // The count, and the one most likely to have been forgotten. Not the
        // whole list: the card is the list, and this is only here to tell you
        // whether opening it is worth doing.
        var head = needsYou + (needsYou === 1 ? " needs you" : " need you");
        var first = service ? service.firstNeedsYou() : null;
        if (!first) {
            return "Shepherd — " + head;
        }
        var age = service.ageOf(first);
        var name = plain(first.name);
        var tail = plain(first.label) + (name !== "" ? " " + name : "") + ", " + plain(first.phrase) + (age !== "" ? " (" + age + ")" : "");
        return "Shepherd — " + head + "\noldest: " + tail;
    }

    function _clock(epochMs) {
        var d = new Date(epochMs);
        var hh = String(d.getHours());
        var mm = String(d.getMinutes());
        return (hh.length < 2 ? "0" + hh : hh) + ":" + (mm.length < 2 ? "0" + mm : mm);
    }

    // A Grid rather than a Row: on a vertical bar the glyph and its count have
    // to stack, or they run out past the bar's edge as soon as the count
    // reaches two digits.
    Grid {
        id: content
        anchors.centerIn: parent
        columns: root.vertical ? 1 : 2
        spacing: Style.spacing.xs
        horizontalItemAlignment: Grid.AlignHCenter
        verticalItemAlignment: Grid.AlignVCenter

        Text {
            text: root.glyph
            font.family: bar ? bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.body
            color: root.tone
            textFormat: Text.PlainText
        }

        Text {
            visible: root.counting
            text: String(root.needsYou)
            font.family: bar ? bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.body
            color: root.tone
            textFormat: Text.PlainText
        }
    }

    MouseArea {
        anchors.fill: parent
        enabled: root.showing
        hoverEnabled: true
        onClicked: if (bar && bar.shell) {
            bar.shell.toggle("scoop.shepherd", "{}");
        }
        onEntered: if (bar) {
            bar.showTooltip(root, root.tooltipText());
        }
        onExited: if (bar) {
            bar.hideTooltip(root);
        }
    }
}
