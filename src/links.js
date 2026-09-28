// Opening a session in an installed Shepherd app rather than a new tab.
//
// A URL handed to xdg-open always becomes a new browser tab: nothing a launcher
// can say means "focus the tab that already shows this". An installed Chromium
// app can do better. Shepherd's manifest registers the web+shepherd scheme and
// asks for launch_handler "focus-existing", so a web+shepherd link reaches the
// window that is already open, brings it forward, and is routed there through
// launchQueue without a reload.
//
// Chromium registers the scheme with xdg only when the app is installed, so
// whether xdg-mime names a handler for it is exactly the question "is the app
// installed". Anything else falls back to the https URL.
//
// Loaded unchanged by both QML and bun; no imports.

var APP_SCHEME = "web+shepherd";

/**
 * The link an installed Shepherd app routes to one session.
 *
 * The id is percent-encoded so it stays one path segment, and the link always
 * begins with the scheme, so xdg-open cannot mistake it for an option.
 *
 * @param {string} id
 */
function appLink(id) {
    return APP_SCHEME + "://session/" + encodeURIComponent(id);
}

/**
 * Whether `xdg-mime query default x-scheme-handler/web+shepherd` named one.
 *
 * It prints the desktop file's name, or nothing, and exits 0 either way. One
 * line ending in .desktop is the only answer taken as yes.
 *
 * @param {string | undefined} text
 * @param {number} code
 */
function hasAppHandler(text, code) {
    if (code !== 0 || typeof text !== "string") {
        return false;
    }
    return /^[^\s/]+\.desktop$/.test(text.trim());
}

if (typeof module !== "undefined") {
    module.exports = {
        APP_SCHEME: APP_SCHEME,
        appLink: appLink,
        hasAppHandler: hasAppHandler,
    };
}
