// Types for the pure functions in src/.
//
// Written by hand rather than generated, and deliberately narrower than
// Shepherd's own types: this plugin reads six fields off a Session that has
// about seventy, and saying so here is what keeps the rest out of the code.
//
// The shapes that come from Shepherd mirror src/types.ts in the Shepherd repo
// (HoldReason, HoldParams, SessionStatus). When Shepherd adds a hold code, this
// file does not need to change — an unknown code is a value of `string`, and
// src/holds.js decides what to do with it.

export type Tier = "needs-you" | "working" | "waiting";

/** Shepherd's HoldParams, restricted to what the card renders. */
export interface HoldParams {
    round?: number;
    cap?: number;
    findings?: number;
    resetAt?: number;
    pr?: number;
    rebaseCount?: number;
    question?: string;
    steps?: number;
}

/** Shepherd's HoldReason. */
export interface Hold {
    code: string;
    params?: HoldParams;
}

/** One hold, tiered and put into words. */
export interface Described {
    code: string;
    tier: Tier;
    known: boolean;
    phrase: string;
    question: string;
}

/** The fields of a Shepherd Session this plugin reads. */
export interface Session {
    id: string;
    desig?: string;
    name?: string;
    repoPath?: string;
    status?: string;
    createdAt?: number;
    /** Operator-flagged "ready to merge"; Shepherd renders it as its own group. */
    readyToMerge?: boolean;
    /** Stamped while a merge train is carrying this session. */
    mergingSince?: number | null;
}

/** The fields of a Shepherd GitState this plugin reads. */
export interface GitState {
    state?: "none" | "open" | "merged" | "closed";
    checks?: "none" | "pending" | "success" | "failure";
    isDraft?: boolean;
    noCi?: boolean;
    handoff?: "reviewer" | "merger";
    number?: number;
}

/** A lifecycle stage, mirrored from Shepherd's herd partition. */
export type Stage =
    "your-turn" | "draft-awaiting-signoff" | "waiting-on-reviewer" | "waiting-on-merger";

/** What one poll returned. */
export interface Snapshot {
    sessions: Session[];
    holds: Record<string, Hold>;
    git?: Record<string, GitState>;
    /** Sessions with a critic or plan reviewer in flight; empty when not known. */
    inReview?: string[];
}

/** One hold as this plugin has been watching it. */
export interface SeenHold {
    code: string;
    firstSeen: number;
    /** Whether we saw the session before this hold began. */
    exact: boolean;
}

/** What the previous poll left behind, so ages survive between polls. */
export interface Seen {
    sessions: Record<string, true>;
    holds: Record<string, SeenHold>;
}

/** One line in the card. */
export interface Row {
    id: string;
    label: string;
    /** What the session is about; empty when it would repeat the label. */
    name: string;
    repo: string;
    tier: Tier;
    code: string;
    phrase: string;
    question: string;
    heldSince: number | null;
    ageExact: boolean;
    createdAt: number;
}

export interface Counts {
    needsYou: number;
    working: number;
    waiting: number;
}

export interface Built {
    rows: Row[];
    seen: Seen;
    counts: Counts;
}

/** A base URL after parsing. */
export interface ParsedUrl {
    ok: boolean;
    reason: "" | "empty" | "malformed" | "too-long";
    url: string;
    scheme: string;
    host: string;
    /** http:// to somewhere that is not this machine. */
    plaintext: boolean;
}

/** What one poll attempt came back as. */
export type Outcome =
    | "never"
    | "ok"
    | "unauthorized"
    | "forbidden"
    | "first-run"
    | "malformed"
    | "unreachable"
    | "timeout";

/** Our view of Shepherd. See CONTEXT.md. */
export type State = "unconfigured" | "needs-token" | "degraded" | "unreachable" | "ok";

export interface Attempt {
    baseUrlValid: boolean;
    permitted: boolean;
    hasToken: boolean;
    outcome: Outcome;
}
