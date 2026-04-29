# Connection Timeouts — Subagent TDD Execution Plan

Controller: Haku
Mode: subagent-driven TDD, fresh subagent per implementation task, with separate spec and code-quality review subagents after each task.

## Task 1 — Timeout/countdown pure helpers

Goal: create small pure helpers that define timeout math and display formatting before touching Chrome lifecycle code.

Red first:
- Add failing Vitest coverage for 15-minute TTL deadline creation.
- Add failing coverage for remaining time clamping at zero.
- Add failing coverage for missing/invalid expiry returning null.
- Add failing coverage for `mm:ss` countdown formatting.

Green slice:
- Add helper module in `lib/` for share timeout math/display.
- Export constants/helpers needed by later background/UI code.
- Keep helpers pure and Chrome-free.

Focused tests:
- Run only the new helper test file, then the existing test suite if cheap.

## Task 2 — Background-owned TTL lifecycle

Goal: make timeout equivalent to manual stop sharing.

Red first:
- Add focused tests around extracted lifecycle helper behavior where possible, especially expired persisted state detection and scheduling decisions.
- If direct service-worker tests are impractical, extract the decision logic into pure helpers and test those before wiring.

Green slice:
- Extend host state with `shareStartedAt` / `shareExpiresAt`.
- Set timestamps after successful host start.
- Include `shareExpiresAt` / `shareRemainingMs` in status.
- Schedule expiry in background and clear it on stop.
- On timeout, call the existing stop path with reason `timeout`.
- On restored hosted state, immediately enforce if expired or schedule the remaining time.
- Keep manual stop behavior intact.

Focused tests:
- Run timeout helper/lifecycle tests and any existing background utility tests.

## Task 3 — Viewer graceful stopped UX

Goal: avoid long reconnect loops when the host deliberately stops or times out.

Red first:
- Add failing tests for viewer stop-message state handling in pure helper(s): `hostStopped` should suppress reconnect and produce inactive-share copy.

Green slice:
- Send best-effort `{ type: 'hostStopped', reason }` before offscreen closes the data connection.
- Handle `hostStopped` in `client/viewer.js` by clearing reconnect intent and showing friendly ended/timed-out copy.
- Do not make the stop cleanup depend on delivery of this message.

Focused tests:
- Run viewer stop helper tests and relevant viewer utility tests.

## Task 4 — Popup/bridge countdown status

Goal: surface the 15-minute limit and remaining time while sharing.

Red first:
- Add tests for status copy/formatting helpers where possible.

Green slice:
- Popup shows hosting/connected status with `expires in mm:ss`.
- Bridge status includes remaining time/expiry while hosting.
- Refresh countdown while those surfaces are open if practical without adding complexity.

Focused tests:
- Run countdown/status helper tests.

## Task 5 — Final integration verification, version bump, commit hygiene

Goal: verify the whole feature and satisfy LobsterLink release hygiene.

Steps:
- Run full test suite.
- Run git diff review.
- Bump extension version in `manifest.json` if code changed.
- Commit cohesive final state if prior task commits need cleanup.
- Perform browser/manual UAT with a shortened/debug timeout if feasible, or document the concrete blocker.

## Per-task gates

After each implementation task:
1. Implementer reports red test, green implementation, focused test results, commit SHA.
2. Fresh spec-review subagent verifies the slice against this execution plan and the design plan.
3. Fresh code-quality review subagent checks maintainability, minimality, tests, and integration risk.
4. Any findings go back to a fix subagent/reviewer loop before the next task starts.
