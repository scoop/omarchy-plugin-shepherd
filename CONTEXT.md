# Shepherd Attention Indicator

An Omarchy plugin that answers one question on the bar: how many Shepherd
sessions will not progress until the operator acts. It reads Shepherd and never
writes to it.

## Language

### What is being watched

**Session**:
One coding-agent run inside Shepherd, working in its own git worktree.
Shepherd's own word, kept unchanged.
_Avoid_: Agent, run, job, task, worktree

**Desig**:
The short human label Shepherd gives a Session, of the form `TASK-435`. The
primary way a Session is named in this plugin; a Session without one falls back
to its name, never to a bare identifier.
_Avoid_: Ticket, key, slug, number

**Hold**:
The single reason Shepherd records for why a Session is not progressing, drawn
from Shepherd's fixed set of hold codes. A Session has at most one.
_Avoid_: Block, blocker, status, reason, state

### The three tiers

Every Hold falls into exactly one tier. The tiers are this plugin's own
vocabulary: Shepherd records a Hold's code, not its urgency.

**Needs You**:
A Session that will not progress until the operator acts. The only tier the
Indicator counts, and the meaning of every number this plugin displays.
_Avoid_: Blocked, waiting, stuck, attention, urgent, actionable

**Working**:
A Session that is held, but held by something already underway — an agent
addressing review findings, a merge in flight. Listed in the Card, never
counted.
_Avoid_: Busy, in progress, running, active

**Waiting**:
A Session that is held until a clock runs out, such as a usage window that
resets at a known time. Listed in the Card with that time, never counted,
because the correct response is to do nothing.
_Avoid_: Throttled, paused, quota, rate-limited, blocked

**Held Since**:
The moment this plugin first observed a Session's current Hold. Not a fact
Shepherd reports — it is the age of our own observation, and it resets whenever
the shell restarts. A Hold whose age is unknown shows no age rather than a
confident zero.
_Avoid_: Since, age, started, blocked at, duration

### What is shown

**Indicator**:
The bar presence. Shows a count when any Session Needs You, a dim mark when
Shepherd is reachable with Sessions but none Need You, and nothing at all when
no instance is configured.
_Avoid_: Widget, badge, icon, applet

**Card**:
The surface summoned by clicking the Indicator, listing the held Sessions by
tier. This plugin's only detail view.
_Avoid_: Pane, popup, panel, overlay, menu

### Our view of Shepherd

These describe the connection, never a Session. A Session's condition is never
unknown; our view of it is.

**Unconfigured**:
No Shepherd address has been set. The Indicator is absent entirely.
_Avoid_: Unset, empty, first run, not installed

**Needs Token**:
An address is set, but no credential is stored or the stored one was refused.
Distinct from Unreachable because it will never resolve itself.
_Avoid_: Unauthorized, logged out, auth error, 401

**Degraded**:
Shepherd answers, but not usefully — the credential lacks the scope this plugin
needs, or the instance has not finished its own first-run setup.
_Avoid_: Error, broken, partial, misconfigured

**Unreachable**:
Contact with Shepherd has been lost. Shown distinctly from an empty count,
because a count of zero and not knowing must never look the same.
_Avoid_: Offline, disconnected, down, stale, error
