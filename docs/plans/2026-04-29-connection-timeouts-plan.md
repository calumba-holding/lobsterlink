# LobsterLink Connection Timeouts Plan

Date: 2026-04-29
Thread: Add Connection Timeouts

## Goal

A LobsterLink share should automatically end after a short fixed lifetime, with the same effect as the host/agent manually choosing “stop sharing.” The primary use case is short-lived support/control, so leaving a share active indefinitely is unnecessary risk and unnecessary cleanup burden.

Default share lifetime: **15 minutes**.

## Current behavior observed in code

Relevant files:

- `background.js`
  - Owns host lifecycle and `hostState`.
  - `handleStartHostingCDP()` starts sharing.
  - `handleStopHosting()` stops sharing and resets state.
  - `getStatusPayload()` feeds popup/bridge status.
  - `viewerConnected` / `viewerDisconnected` messages update `hostState.viewerConnected`.
- `offscreen.js`
  - Owns PeerJS host, media call, data connection, canvas stream.
  - `stopHost()` closes data connection, media call, media tracks, PeerJS peer, and canvas state.
- `client/viewer.js`
  - Connects to host peer id.
  - On disconnect, currently attempts reconnect up to 20 times with backoff.
- `popup.js` and `bridge.js`
  - Start/stop host and display basic host status.

Important product model from discussion:

- Timer expiry should not be a special “expired connection” protocol state.
- Timer expiry should invoke the same cleanup path as manual stop sharing.
- After timeout, old links fail naturally because there is no active share/peer anymore.

## Brainstormed approaches

### Option A — Background-owned hard TTL, call existing stop path

The service worker sets an expiry deadline when hosting starts, schedules a timer, and when it fires calls the same `handleStopHosting()` path used by manual stop.

Pros:

- Matches the desired mental model exactly: timeout == manual stop.
- Centralized in the same layer that owns `hostState` and stop cleanup.
- Keeps offscreen PeerJS and viewer protocol simple.
- Easy to test with pure helper functions and mocked timer behavior.

Cons:

- Chrome service workers can be suspended, so the deadline cannot rely only on an in-memory `setTimeout`.
- Needs persisted deadline and status-time recomputation.

### Option B — Offscreen-owned timer

The offscreen document starts a timer when PeerJS starts and destroys the peer on timeout.

Pros:

- Offscreen document already owns PeerJS/media teardown.
- Timer stays near the active stream objects.

Cons:

- Does not fully clean background state unless it messages background, so it can drift from `hostState`.
- Does not naturally clear overlay/debugger/listeners unless it routes back through background stop.
- Less aligned with “same as manual stop.”

### Option C — Viewer-side timer only

Viewer stops reconnecting after 15 minutes or displays an expired message.

Pros:

- Simple UI behavior.

Cons:

- Does not stop the host from sharing.
- Does not solve the safety issue if the host remains active.
- Wrong owner for the policy.

## Recommendation

Use **Option A**: background-owned hard TTL with persisted deadline, and timeout calls the existing manual stop path.

Implementation should treat the timeout as a host lifecycle concern, not a viewer protocol concern.

## Design

### Host state

Extend `DEFAULT_HOST_STATE` with:

- `shareStartedAt`: epoch ms or ISO string
- `shareExpiresAt`: epoch ms or ISO string
- `stopReason`: optional last stop reason for diagnostics only, e.g. `manual`, `timeout`, `tab_closed`

Use epoch milliseconds internally for easy math. Surface formatted time only in UI.

When hosting starts successfully in `startScreencastMode()`:

1. Set `shareStartedAt = Date.now()`.
2. Set `shareExpiresAt = shareStartedAt + 15 * 60 * 1000`.
3. Persist host state.
4. Schedule the expiry timer.

When hosting stops manually or by timeout:

1. Clear any expiry timer.
2. Run the existing stop cleanup.
3. Reset `hostState` to `DEFAULT_HOST_STATE`.
4. Persist reset state.

### Timer resilience

Add a background helper set:

- `HOST_SHARE_TTL_MS = 15 * 60 * 1000`
- `hostExpiryTimer = null`
- `clearHostExpiryTimer()`
- `scheduleHostExpiryTimer()`
- `enforceHostExpiry(reason)`
- `getRemainingShareMs(now = Date.now())`

`scheduleHostExpiryTimer()` should:

- Do nothing if not hosting or no `shareExpiresAt`.
- If already expired, call `enforceHostExpiry('timeout')` immediately.
- Otherwise schedule `setTimeout` for `shareExpiresAt - Date.now()`.

`ensureHostStateLoaded()` should call `scheduleHostExpiryTimer()` after restoring a hosted state. This avoids stale active shares after a service worker sleep/wake. Any `getStatus`, `startHostingCDP`, `viewerConnected`, `inputEvent`, or `controlEvent` path that calls `ensureHostStateLoaded()` will re-check expiry before proceeding.

`enforceHostExpiry('timeout')` should call the same cleanup path as manual stop, e.g. `handleStopHosting({ reason: 'timeout' })`. It should guard against reentry so two simultaneous events do not double-stop.

### Manual stop path

Refactor `handleStopHosting()` to accept an optional options object:

```js
async function handleStopHosting({ reason = 'manual' } = {}) { ... }
```

The cleanup should stay the same:

- teardown tab listeners
- remove host overlay
- stop screencast
- clear emulation override
- message `offscreen:stopHost`
- detach debugger
- close offscreen document
- reset `hostState`
- persist reset state

The only additions should be clearing the expiry timer and logging `reason` in diagnostics.

### Viewer behavior

When the host stops due to timeout, the data connection/media call will close just like manual stop.

Viewer should keep existing reconnect behavior for transient network drops, but it should not keep trying forever after a host stop. Current behavior retries up to 20 attempts, which can leave a viewer showing reconnect attempts for several minutes after an intentional stop/timeout.

Recommended small UX improvement:

- Host sends a final data message before closing, e.g. `{ type: 'hostStopped', reason: 'timeout' | 'manual' }`.
- Viewer handles `hostStopped` by:
  - clearing `connectedPeerId`
  - clearing reconnect timer
  - showing overlay
  - setting message: `Share ended. Ask the agent to start a new share.`
- If reason is `timeout`, optional copy: `Share timed out. Ask the agent to start a new share.`

This message is not part of connection acceptance. It is just graceful UX before the same hard stop cleanup happens.

If the final message fails to send, nothing breaks. The host still stops, and future reconnects fail because there is no peer.

### UI surfaces

Minimum viable UI:

- `getStatusPayload()` includes:
  - `shareExpiresAt`
  - `shareRemainingMs`
- `popup.js` and `bridge.js` display remaining time while hosting:
  - `Hosting — expires in 14:32`
  - When connected: `Viewer connected — expires in 14:32`

Nice-to-have but not required:

- Update the countdown live every second while popup/bridge is open.
- Show a subtle “15 min max” note near the share link.

Do not add extension settings yet. Fixed 15 minutes is simpler and matches the current use case.

## Implementation plan

### Phase 1 — Background TTL lifecycle

1. Add TTL constants and timer state to `background.js`.
2. Extend `DEFAULT_HOST_STATE`, `serializeHostState()`, and `getStatusPayload()` with started/expires/remaining fields.
3. Add timer helpers:
   - `clearHostExpiryTimer()`
   - `getShareRemainingMs()`
   - `scheduleHostExpiryTimer()`
   - `enforceHostExpiry()`
4. On successful `startScreencastMode()`, set timestamps and schedule expiry.
5. In `ensureHostStateLoaded()`, after restoring state, schedule or immediately enforce expiry.
6. Refactor `handleStopHosting({ reason })` and ensure both manual stop and timeout use it.
7. Add diagnostics events:
   - `share_expiry_scheduled`
   - `share_timeout_reached`
   - `host_stopped` with reason

### Phase 2 — Graceful viewer stop message

1. Add an offscreen message action, e.g. `offscreen:notifyHostStopped`, or extend `offscreen:stopHost` to accept `reason` and send the final viewer message before closing.
2. In `offscreen.js`, before closing `dataConnection`, try `sendToViewer({ type: 'hostStopped', reason })`.
3. Keep cleanup best-effort; never block stop on the message.
4. In `client/viewer.js`, handle `hostStopped`:
   - stop reconnecting
   - cleanup current media/data state
   - show overlay
   - show friendly inactive-share copy

### Phase 3 — Status/countdown UI

1. Update popup status text to include remaining time when hosting.
2. Update bridge status view to include remaining time and/or expiry timestamp.
3. Add a small formatter helper for `mm:ss` remaining display.
4. Optional: refresh status every second while UI is open.

### Phase 4 — Tests

Add pure helper tests where possible:

- Remaining time clamps at zero.
- Missing expiry returns null.
- Expired state schedules immediate stop.
- Viewer `hostStopped` handling disables reconnect.
- Countdown formatter outputs expected values.

Existing test structure uses Vitest and pure helper modules in `lib/`, so prefer extracting small helpers into `lib/background-utils.js` or a new `lib/share-timeout-utils.js` rather than testing Chrome APIs directly.

### Phase 5 — Manual UAT

Verify in the browser extension with a shortened TTL during test or injected debug constant:

1. Start sharing.
2. Confirm popup/bridge show remaining time.
3. Connect viewer.
4. Wait for timeout.
5. Confirm host overlay disappears.
6. Confirm viewer disconnects and does not keep reconnecting indefinitely.
7. Confirm old viewer link cannot reconnect.
8. Start a new share and confirm a new active peer/link works.
9. Confirm manual stop still behaves the same as before.

## Acceptance criteria

- A share automatically stops after 15 minutes.
- Timeout uses the same cleanup behavior as manual stop sharing.
- Host PeerJS peer is destroyed at timeout.
- Data/media connections are closed at timeout.
- Capture/screencast/debugger/overlay state is cleaned up at timeout.
- Persisted hosted state cannot survive past its expiry after service worker sleep/wake.
- Old share links do not reconnect after timeout.
- Viewer receives friendly “share ended/timed out” UX when possible.
- Viewer does not continue long reconnect loops after a deliberate host stop/timeout.
- Manual stop still works.
- Tests cover pure timeout/countdown/viewer-stop helpers.

## Non-goals

- Configurable timeout duration.
- Server-side session registry.
- Special expired-share signaling protocol.
- Keeping old links resumable.
- Changing PeerJS library internals.
