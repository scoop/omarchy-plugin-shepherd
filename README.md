# Shepherd — Omarchy bar widget

How many [Shepherd](https://shepherd.run) sessions are waiting on you, on the
Omarchy bar. The bar stays empty until one is.

Shepherd runs a herd of coding agents so that you do not have to watch them. The
point of this widget is the other half of that: telling you the moment watching
is required, and getting you to the session in one click.

## What the number means

**This many sessions stop until you act.** Nothing else is allowed to put a
number on the bar.

Shepherd records one hold code per session — the reason it is not progressing —
and this plugin sorts those codes into three tiers by who has to move next:

| Tier                   | Holds                                                                                                                                                                                                                      | Where it shows                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Needs you**          | `blocked-menu` `blocked-yes-no` `blocked-awaiting-input` `blocked-stall` `blocked-generic` `autopilot-paused` `plan-question` `halted-error` `train-error` `ready-merge` `awaiting-merge` `manual-steps` `recap-attention` | the count on the bar, and the card |
| **Being worked**       | `plan-rework` `critic-rework` `ci-red` `pr-conflict` `merging` `merge-rebasing` `stalled`                                                                                                                                  | the card only                      |
| **Waiting on a reset** | `halted-usage` `quota-rework` `quota-review` `quota-error` `quota-plan`                                                                                                                                                    | the card only, with the reset time |

One row comes from somewhere other than a hold. A session whose pull request is
open, CI is green and the agent has handed off carries **no hold at all** —
Shepherd's only attention signal for it is "in-flight", which has no hold code —
so a card built from holds alone cannot see the group Shepherd's own HUD labels
**Your turn**. That group is derived here from the pull request state instead,
mirroring the predicate in Shepherd's `herd-partition.ts`, and it counts as
needing you: it is finished work waiting for a click.

A hold code this plugin has not been taught is shown in **Being worked** with
its raw code, never counted and never dropped: Shepherd ships faster than this
plugin does, and a new code should not be able to raise a false alarm or to hide
a stuck session.

## What the bar shows

| State                                            | Bar                                                    |
| ------------------------------------------------ | ------------------------------------------------------ |
| No address configured                            | nothing at all                                         |
| Reachable, sessions running, none waiting on you | a dim dot — click it to open the card                  |
| One or more sessions waiting on you              | a count                                                |
| No token stored, or the stored one was refused   | a lock — click it to sign in                           |
| Unreachable                                      | a dim broken-link mark, with the time contact was lost |

A failed poll clears the count rather than leaving the last one on the bar. A
stale "2 need you" costs a context switch, and the number is only worth
something if it is never a number the plugin is not currently sure of.

Clicking a row in the card opens Shepherd's own view of that session in your
browser — `<address>/?session=<id>` — because a `read` token cannot approve,
merge or steer anything, and a row that offered to would be lying. It opens
through `omarchy-launch-browser` where that exists, which also brings the
browser window to the front; otherwise through `xdg-open`, then `gio open`.

## Requirements

- Omarchy 4.0 or newer (the Quickshell-based bar).
- A Shepherd instance you can reach, and an access token with the **`read`**
  scope. Mint one in Shepherd under **Settings → Access → Create a token**; the
  plaintext is shown once, at creation.
- `curl` and `secret-tool` (`libsecret`), both of which Omarchy already installs.

A `read` token reaches six routes and nothing else. It cannot spawn a session,
type into a terminal or merge a pull request. **Do not paste a `full` token
here** — the plugin does not need one and will refuse to do anything with it
that it could not do with a `read` one.

## Install

```bash
omarchy plugin add https://github.com/scoop/omarchy-plugin-shepherd
~/.config/omarchy/plugins/scoop.shepherd/bin/authenticate.sh
```

The widget is invisible until an address is configured, so there is no click
target on a fresh install — `authenticate.sh` is the way in. It asks for the
address and the token, checks both against Shepherd before committing to either,
stores the token in your login keyring and writes the address to `shell.json`
through Omarchy's own `omarchy bar` commands.

Afterwards, a revoked token can be replaced from the card itself: the widget
shows a lock, and clicking it opens a field to paste a new one.

### Doing it by hand

```bash
omarchy bar put scoop.shepherd right
omarchy bar set scoop.shepherd baseUrl 'https://shepherd.your-tailnet.ts.net'
printf '%s\n' 'YOUR_READ_TOKEN' | \
  ~/.config/omarchy/plugins/scoop.shepherd/bin/token.sh store 'https://shepherd.your-tailnet.ts.net'
```

### Settings

Set with `omarchy bar set scoop.shepherd <key> <value>`; they live inline on the
plugin's entry in `~/.config/omarchy/shell.json`.

| Key                 | Default | Meaning                                                                     |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| `baseUrl`           | `""`    | Shepherd's address: scheme and host only, no path.                          |
| `pollIntervalSec`   | `30`    | Seconds between polls, 15–600. Backs off to five minutes while unreachable. |
| `allowPlaintextFor` | `""`    | The one `http://` address plaintext is permitted for. See below.            |

### Plaintext HTTP

The plugin refuses to send a bearer token over `http://` to anything that is not
this machine. `http://127.0.0.1:7330` — Shepherd's own default bind — needs no
consent, because that request crosses nothing. Any other `http://` address needs
consent granted for exactly it:

```bash
omarchy bar set scoop.shepherd allowPlaintextFor 'http://192.168.1.10:7330'
```

Consent is stored as the address rather than as a flag, so pointing the plugin
at a different Shepherd withdraws it automatically.

## What it talks to, and what it writes

Every request this plugin makes, in full:

| Request                      | Authenticated | Why                                                                                                                             |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET <address>/api/health`   | no            | liveness, once per poll, before anything else — it is how "you are off the network" is told apart from "your token was refused" |
| `GET <address>/api/sessions` | yes           | the live sessions                                                                                                               |
| `GET <address>/api/holds`    | yes           | why each one is held                                                                                                            |
| `GET <address>/api/git`      | yes           | each one's pull request state — the only way to see the group Shepherd calls "Your turn"                                        |

Nothing else. No `POST`, no `PUT`, no `DELETE`, no WebSocket, and no request to
any host other than the address you configured. `bin/token.sh` additionally
calls `GET <address>/api/holds` once when verifying a token you have just
pasted, to check it works before storing it.

Files this plugin writes:

| Where                              | What                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| your login keyring (`secret-tool`) | the access token, under service `scoop.shepherd`, account `<address>` |
| `~/.config/omarchy/shell.json`     | `baseUrl` and the other settings, via `omarchy bar set`               |

Nothing else — no cache, no state file, no log. The session snapshot lives in
memory for as long as the shell runs and is worth exactly as much as the poll it
came from.

The token is never an argument to any process and never in an environment
variable: `/proc/<pid>/cmdline` and `/proc/<pid>/environ` are readable by every
process running as you. It is looked up from the keyring inside the helper that
uses it and handed to `curl` on stdin, and the QML side never holds it at all.

## Removing

```bash
omarchy plugin remove scoop.shepherd
secret-tool clear service scoop.shepherd account 'https://shepherd.your-tailnet.ts.net'
```

`omarchy plugin remove` deletes the plugin directory and its entry in
`shell.json`. It does **not** remove the token from your login keyring — the
second command does, and takes the same address you configured. Nothing else of
this plugin's survives; it writes nothing anywhere else.

## Commands

```bash
omarchy-shell scoop.shepherd.service refresh   # poll now, or leave demo mode
omarchy-shell scoop.shepherd.service status    # our view of the connection
omarchy-shell scoop.shepherd.service demo      # load demo/snapshot.json
```

`status` answers with one of `unconfigured`, `needs-token`, `degraded`,
`unreachable`, `ok` — this plugin's view of the connection, never anything about
a session. These are reachable with nobody present, so none of them discloses
anything from Shepherd, changes anything on Shepherd, or writes anything down.

`demo` loads a fixture so the card can be photographed and worked on without
three agents conveniently stuck; the card says "demo data" while it is loaded,
and `refresh` returns to the live view.

To open the card from the keyboard, add a binding of your own to
`~/.config/hypr/bindings.lua` — that is the file Omarchy 4 loads, via
`require("hypr.bindings")` in `hyprland.lua`. A `bindings.conf` left over from
an earlier Omarchy is no longer read:

```lua
o.bind("SUPER + Y", "Shepherd", "omarchy-shell shell toggle scoop.shepherd")
```

Then `omarchy-restart-shell`, or reload Hyprland. Pick a key that is free —
`omarchy menu keybindings --print` lists what is taken. If you are replacing an
Omarchy default, unbind it first:

```lua
hl.unbind("SUPER + Y")
o.bind("SUPER + Y", "Shepherd", "omarchy-shell shell toggle scoop.shepherd")
```

## Development

Fetch the dev dependencies with bun, then:

```bash
bun test          # the pure logic in src/, and the helper scripts in bin/
bun run lint
bun run typecheck
bun run validate  # runs Omarchy's validator against `git archive HEAD`
```

Those dependencies are linters and a test runner, and they are needed only to
work on the plugin. Installing it with `omarchy plugin add` neither runs nor
needs them: nothing in the plugin installs, upgrades or removes software.

`src/*.js` is plain JavaScript loaded byte-for-byte by both QML and `bun test`,
typed by hand in `src/types.d.ts` — see
[docs/adr/0003](docs/adr/0003-plain-js-with-declaration-files.md). The words this
plugin uses, and the ones it deliberately does not, are in [CONTEXT.md](CONTEXT.md).

## Licence

MIT. Shepherd itself is a separate project under BUSL-1.1; this is an
independent client that speaks its documented HTTP API.
