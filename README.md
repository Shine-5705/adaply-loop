# Adaply Loop

**Your coding agent should only need to be told once.**

Developers correct their AI coding agents the same way, over and over: *"no, use pnpm"*, *"don't edit generated files"*, *"we use vitest"*. Each session starts from zero, and hand-written rules files only hold what someone remembered to write down.

Adaply Loop reads the session logs your agents already write, finds the corrections you keep repeating, and turns the recurring ones into versioned `AGENTS.md` rules, so every agent on the team gets them.

**Website:** https://shine-5705.github.io/adaply-loop/ · **Workspace demo (runs in your browser, nothing is uploaded):** https://shine-5705.github.io/adaply-loop/app/?sample

```
$ node bin/adaply-loop.mjs propose examples/sessions --repo examples/repo
Adaply Loop 0.1.0  6 sessions (4 claude-code, 2 codex) · 9 corrections · 1 secrets redacted

✔ ADOPT  R01  Use pnpm instead of npm
          3x in 3 session(s) · claude-code, codex · ✓ recurs  ✓ not-duplicate  ✓ no-conflict
✔ ADOPT  R03  Never edit files in src/gen by hand
          2x in 2 session(s) · claude-code, codex · ✓ recurs  ✓ not-duplicate  ✓ no-conflict
✔ ADOPT  R04  Use vitest, not jest
          2x in 2 session(s) · claude-code, codex · ✓ recurs  ✓ not-duplicate  ✓ no-conflict
· hold   R05  Put colors in the theme tokens in styles/tokens.css, do not hardcode hex values
          1x in 1 session(s) · claude-code · ✗ recurs  ✓ not-duplicate  ✓ no-conflict
```

(Output from the bundled **synthetic** sample sessions, see [examples/README.md](examples/README.md).)

## How it works

| Stage | What it does | Status |
|---|---|---|
| 1. Capture | Parses Claude Code (`~/.claude/projects/**/*.jsonl`) and Codex (`~/.codex/sessions/**/rollout-*.jsonl`) logs. Skips tool results and injected context. Redacts API keys, tokens, passwords and emails **before** anything else touches the text. | ✅ v0.1 |
| 2. Find | Flags user turns that follow an agent turn and correct it ("no, …", "don't …", "I said …", "use X instead of Y"), and extracts each imperative as a candidate rule. One message can yield several rules. | ✅ v0.1 (heuristic) |
| 3. Cluster | Groups the same correction across sessions and harnesses (token-set similarity with tool-name normalisation). | ✅ v0.1 |
| 4. Gate | Adopts a rule only if it recurs in ≥2 separate sessions, isn't already in `AGENTS.md`, and doesn't contradict an existing line. | ✅ v0.1 |
| 4b. Replay gate | Re-run past tasks in a sandbox with and without the rule; adopt only if it fixes the target and regresses nothing. | 🚧 Round 2 |
| 5. Ship | Writes a marked, idempotent block into `AGENTS.md`; every apply is versioned in `.adaply/versions/` with full evidence; `rollback` restores the previous file. | ✅ v0.1 |

The same engine (`src/engine.mjs`, zero dependencies) powers the CLI and the browser dashboard.

## Quick start

```bash
git clone https://github.com/Shine-5705/adaply-loop && cd adaply-loop
npm run demo                                   # sample data
node bin/adaply-loop.mjs scan                  # your own ~/.claude and ~/.codex logs
node bin/adaply-loop.mjs apply --repo ~/code/app
node bin/adaply-loop.mjs log --repo ~/code/app
node bin/adaply-loop.mjs rollback --repo ~/code/app
npm test
```

Node 18+. No install step, no network calls, no telemetry.

## Roadmap (INNOVATE INDIA 2026, Round 2)

- Replay test gate (Docker sandbox, before/after on the team's own past tasks)
- Optional LLM classifier for corrections the heuristics miss (model-agnostic, runs after local redaction)
- Cursor rules / `CLAUDE.md` writers and an MCP server that serves learned context on demand
- GitHub PR mode: open the rule change as a pull request for human review

## Honesty notes

- Correction detection in v0.1 is rule-based. It will miss some corrections and occasionally extract an awkward rule; that's why nothing is adopted without recurring and why the output is a reviewable diff.
- The sample sessions are hand-written in the real on-disk formats; they are not customer data, and the numbers above describe only that sample.

## License

MIT © 2026 Shine Gupta (TheAdaply)
