# LobsterLink

## The pain

Agent-controlled browsers break exactly where things get useful.

The agent can open pages, click buttons, and fill forms, but it falls apart when the task depends on a browser session that already belongs to a human:

- a site is logged in in the human's browser, not the agent's
- the agent needs to see and use the real authenticated tab
- Chrome extension UI and `tabCapture` require user gestures
- remote control hacks freeze, blur, or lose the host tab
- browser automation tools often block `chrome-extension://` flows
- "just share the browser" usually means giving up reliability or control

That is the gap LobsterLink is meant to close.

## The dream

A human keeps browsing normally in a real Chrome tab.

An agent can:
- see that exact tab
- interact with it remotely
- keep using the human's authenticated session
- switch tabs when needed
- stop sharing cleanly
- do all of this through a repeatable, automatable workflow

In other words: a browser tab becomes shareable infrastructure for agents.

## The product

LobsterLink is a Chrome extension for hosting and viewing live browser tabs over WebRTC.

It gives you two sides:
- **Host**: the browser that owns the real tab and session
- **Viewer**: the remote surface that sees the tab and sends control input back

And it gives you two capture paths:
- **tabCapture**: best fidelity, but requires a real human gesture
- **CDP screencast**: works programmatically, which is what makes agent workflows viable

The key idea is simple:

> When normal browser automation cannot use the authenticated tab directly, LobsterLink lets the agent work through that tab instead of pretending to recreate it.

## Why this exists

LobsterLink is built for the awkward middle ground between:
- normal browser automation, and
- full remote desktop

Browser automation is great when the agent can own the session.
Remote desktop is too blunt when the agent only needs one live tab.

LobsterLink is the smaller, more precise primitive:
- host one tab
- preserve the real session
- drive it remotely
- keep the workflow scriptable

## Agent-first design

LobsterLink is not just a human popup extension.

It includes a dedicated bridge page for automation:

```text
chrome-extension://<extension-id>/bridge.html
```

That bridge runs in extension context and is the preferred control surface for agent-managed browsers. It exposes:

- start host
- stop host
- current peer ID
- current hosted tab
- switch hosted tab
- launch/connect viewer
- viewport control
- diagnostics and last error

For direct programmatic control, the extension also supports runtime messages like:

```js
chrome.runtime.sendMessage({ action: 'startHostingCDP', tabId: 123 });
```

That starts the host in CDP screencast mode instead of popup-driven `tabCapture` mode.

## OpenClaw integration

This repo includes an OpenClaw skill:

- `openclaw/lobsterlink-tab-share/SKILL.md`

If LobsterLink is not already on the OpenClaw host, use the copy-paste install prompt below. It tells OpenClaw to fetch LobsterLink as an archive, unpack it locally, wire it into the isolated `openclaw` browser profile, and verify that it is really loaded.

### Copy-paste install prompt for OpenClaw

```text
You are on an OpenClaw host. Install and configure the unpacked LobsterLink Chrome extension for the isolated OpenClaw-managed browser profile (`openclaw`), then verify it is really loaded.

Source repo:
- GitHub repo: `davidguttman/lobsterlink`

Assume LobsterLink is not present locally yet.
Do not git clone it.
Fetch it as an archive, unpack it locally, and use the extracted directory as the extension source path.

Preferred fetch path:
1. Use GitHub CLI if available:
   - `gh repo archive davidguttman/lobsterlink --format zip --output /tmp/lobsterlink.zip`
2. Unzip it into a local working directory.
3. Find the extracted top-level LobsterLink directory and use its absolute path as the extension source path.

Fallback if `gh` is unavailable:
1. Download an authenticated archive for `davidguttman/lobsterlink`.
2. Unzip it locally.
3. Use the extracted top-level directory as the extension source path.

Goal:
Load this unpacked extension into the isolated `openclaw` browser via config so it survives browser restarts and can be used later by the agent.

Requirements:
- Use the isolated `openclaw` profile, not the human's real browser.
- Configure extension loading through OpenClaw browser config, not manual one-off clicks.
- Preserve unrelated browser settings.
- Verify with evidence, do not assume.

What to inspect first:
1. Browser config schema for:
   - `browser`
   - `browser.extraArgs`
2. Current browser config.
3. Current browser plugin availability.

Config goals:
- `browser.defaultProfile = "openclaw"`
- `browser.headless = false`
- `browser.extraArgs` must include:
  - `--disable-extensions-except=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>`
  - `--load-extension=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>`

Example patch target:
{
  "browser": {
    "defaultProfile": "openclaw",
    "headless": false,
    "extraArgs": [
      "--disable-extensions-except=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>",
      "--load-extension=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>"
    ]
  }
}

Execution steps:
1. Fetch and unpack LobsterLink locally.
2. Inspect the current config schema and current config.
3. Patch config safely.
4. Restart OpenClaw if needed so browser launch args refresh.
5. Start the isolated browser profile.
6. Verify the live Chromium process includes:
   - `--user-data-dir=...openclaw...`
   - `--remote-debugging-port=...`
   - `--load-extension=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>`
7. Verify the extension is actually loaded by checking at least one of:
   - isolated profile Preferences or extension settings
   - CDP `/json/list` extension service worker or page targets
8. Discover and report the extension ID.
9. Report the exact config fields changed.

Final answer must include:
- whether LobsterLink was fetched as an archive or was already local
- extension source path
- whether config was updated
- whether OpenClaw/browser was restarted
- extension ID
- proof that Chromium was launched with the extension flags
- proof that the extension is loaded in the isolated profile

Do the work, do not just describe it.
```

After that, use the `lobsterlink-tab-share` skill for actual workflows like:
- share the LinkedIn tab
- give me the LobsterLink peer ID
- use my logged-in tab
- stop sharing

The skill is designed around the reliable path:
- use the isolated OpenClaw browser profile
- open the bridge page
- start hosting through the runtime/CDP path
- verify hosting state
- return the peer ID
- return the public link `https://lobsterl.ink/?peerId=<PEER_ID>`
- re-focus the hosted tab

## Setup

1. Clone this repo.
2. Optional but useful during development, start the local dev runtime:

```bash
node scripts/dev-runtime.js
```

This starts:
- a local diagnostic log collector at `http://127.0.0.1:8787`
- automatic `manifest.json` version stamping on file changes

You can also run the pieces separately:

```bash
node scripts/log-server.js
node scripts/watch-version.js
```

3. Open `chrome://extensions` in Chrome.
4. Enable Developer mode.
5. Click **Load unpacked** and select this repo.
6. The LobsterLink extension icon should appear in the toolbar.

## Basic usage

### Host

1. Open the tab you want to share.
2. Start hosting through the popup or bridge.
3. Get the generated peer ID.
4. Connect from the viewer.

### Viewer

1. Open the viewer.
2. Paste the peer ID.
3. Connect.
4. The remote tab video appears and input events are forwarded to the host.

## Requirements

- Chrome or Chromium
- headed browser for `tabCapture`
- internet connectivity for PeerJS signaling and WebRTC connectivity
- if running on a server, use a real display environment such as Xvfb

Example:

```bash
xvfb-run google-chrome --no-sandbox
```

## Troubleshooting

- **"Extension is debugging this tab" infobar**
  - Expected when `chrome.debugger` is attached.
  - Do not dismiss it while remote control is active.

- **Frozen or black host video**
  - In `tabCapture` mode, the host tab must stay active.
  - If the viewer lives in the same window, Chrome may background the host tab and freeze capture.

- **`chrome-extension://` navigation is blocked by automation tooling**
  - Open the bridge via CDP target creation instead of normal page navigation.

- **The popup exists but hosting is not actually running**
  - Check bridge/runtime state directly.
  - Do not treat popup visibility as proof.

- **No frames in screencast mode**
  - CDP screencast can stall on visually static pages.
  - LobsterLink restarts screencast on viewer connect and uses frame ticking to keep output alive.

- **Connection fails**
  - Both sides must reach PeerJS signaling and successfully establish a WebRTC path.

## Local diagnostics

Run the log collector before reproducing debugger or focus issues:

```bash
node scripts/log-server.js
```

LobsterLink posts JSON events to:

```text
http://127.0.0.1:8787/log
```

The server appends them to the local debug log file configured by the logger.


Useful events include:
- `tab_activated`
- `tab_created`
- `switch_tab_requested`
- `debugger_attach_*`
- `debugger_detached_externally`
- `input_dropped_*`
- `host_guard_installed`

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Architecture

```text
Host browser                        Viewer
┌──────────────────────────┐       ┌──────────────────────────┐
│ tabCapture / screencast  │       │ live video render        │
│ offscreen document       │──RTC─▶│ control surface          │
│ chrome.debugger input    │◀─RTC──│ mouse / keyboard / nav   │
│ chrome.tabs tab control  │◀─RTC──│ tab + viewport commands  │
└──────────────────────────┘       └──────────────────────────┘
```

## Permissions

- `tabCapture` — capture live tab video
- `tabs` — inspect and manage tabs
- `debugger` — inject input events and run screencast via CDP
- `activeTab` — access active tab on user gesture
- `offscreen` — handle media and rendering work offscreen

## Public web client

The `client/` directory is a plain static version of the viewer. It contains the same
`viewer.html` / `viewer.js` as the extension, packaged as static files (`index.html`,
`viewer.js`, `lib/peerjs.min.js`) that can be served by any static file host so anyone
with a host peer ID can connect from a browser without installing the extension.

See `client/README.md` for the file layout and a local preview command.
