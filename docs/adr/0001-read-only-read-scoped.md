---
status: accepted
---

# Read-only, on a `read`-scoped token, and nothing more

Shepherd mints named access tokens in three scopes. `full` reaches every route:
it can spawn sessions, steer a live terminal, merge pull requests. `read`
reaches exactly six — `GET /api/sessions`, `/api/holds`, `/api/git`, `/api/me`,
`POST /api/ping` and `GET /events` — and its own doc comment in
`src/token-scopes.ts` says it exists for "status surfaces a dashboard or
launcher consumes". This plugin takes `read` and takes nothing else, which fixes
its blast radius at a number on a bar: a compromised or merely buggy plugin
cannot start work, cannot land work, and cannot type into a terminal.

That is a boundary decision, not a starting point. Every feature that would be
natural to add later — approve a plan from the Card, merge from the Card, show
the critic's findings, show a preview URL, open one session's detail — needs
`full`, because Shepherd's scope allowlist is exact-match with no prefix
inheritance and `GET /api/sessions/:id` is not in it. Adding any of them means
asking every user of this plugin to hand a bar widget the ability to merge their
pull requests. The answer when one of them is wanted is an upstream pull request
adding that route to `READ_ROUTES` — a file that explicitly invites deliberate
allowlist edits — not a scope bump here.

## Consequences

The Card can show that a session is held and why, but not the detail behind the
why: review findings, plan questions beyond the verbatim text Shepherd already
puts in `HoldParams.question`, preview ports, usage percentages and epics are
all out of reach. Clicking a row therefore opens Shepherd itself rather than
expanding in place.
