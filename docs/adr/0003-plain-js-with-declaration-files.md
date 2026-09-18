---
status: accepted
---

# Plain JavaScript in `src/`, typed by hand-written declaration files

The house rule for this author's projects is TypeScript everywhere. QML's
JavaScript engine loads a file directly — `import "src/tiers.js" as Tiers` — and
cannot load TypeScript, so a TypeScript source would need a build step, and a
build step means the artifact the tests exercise is not the artifact the shell
runs. For a plugin whose correctness lives almost entirely in pure functions
over Shepherd's hold codes, that gap is the one thing worth avoiding.

`src/*.js` is therefore plain JavaScript that both QML and `bun test` load
byte-for-byte, with hand-written `src/*.d.ts` beside it and `tsc --checkJs` in
CI. The types are real at author time and in the gate; there is simply no
compiler between the test and the bar.
