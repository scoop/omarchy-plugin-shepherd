---
status: accepted
---

# Poll three endpoints rather than hold Shepherd's event socket

Shepherd publishes live state on a WebSocket at `GET /events` — around sixty
event types, `session:hold` and `session:git` among them — and its own web UI
bootstraps from snapshot endpoints and then patches from that socket. Copying
that here would give sub-second freshness. It is not worth what it costs: the
Omarchy shell has no WebSocket client, the house pattern for I/O is a bash
helper supervised by `bin/supervise.sh`, and `curl` does not speak RFC 6455. The
options were to hand-roll a framing implementation in bash or Python, or to take
a runtime dependency on `websocat` or node — a bundled binary and a
`manual-setup` classification at marketplace review, for a plugin whose entire
output is a small integer.

So the helper does three authenticated `curl`s on a timer instead. The latency
this gives up is real but small against what the number means: a hold is a state
Shepherd has already decided and will keep until something changes, so the worst
case is being told thirty seconds late that an agent has been waiting for you.

## Consequences

Freshness is bounded by the poll interval, and by the backoff that stretches it
to five minutes while Shepherd is unreachable. Hold age has to be observed
locally rather than derived from an event's arrival, which is why it resets on a
shell restart and is shown as unknown rather than zero until it is real.
