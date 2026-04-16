# LobsterLink

Let a human log into an agent's browser, without sharing credentials.

---

An agent is filtering your LinkedIn spam. It opens Chrome, navigates to LinkedIn, and hits a login wall. Now what? Ask for your password? Stuff a cookie file? Spin up an OAuth dance that LinkedIn doesn't support?

LobsterLink does something simpler. The agent hosts its browser tab over WebRTC and hands you a link:

```text
https://lobsterl.ink/?peerId=abc123-long-uuid
```

You open it. You're looking at the agent's browser. You log in. You close the tab. The agent now has an authenticated session and goes back to work.

That's it. The human is a guest in the agent's browser, not the other way around.

## How it works

LobsterLink is a Chrome extension with two roles:

**Host** , the agent's browser. It captures a live tab and streams it over WebRTC.  
**Viewer** , the human. Opens a URL, sees the tab, sends input back through the connection.

The agent starts hosting via CDP screencast, generates a peer ID, and constructs the viewer URL. The human clicks it, does whatever the agent can't, log in, solve a CAPTCHA, approve a 2FA prompt, and leaves. The agent keeps the session.

```text
Agent browser (Host)                   Human (Viewer)
┌──────────────────────────┐          ┌──────────────────────────┐
│ CDP screencast           │          │ live video render        │
│ offscreen document       │──RTC───▶ │ control surface          │
│ chrome.debugger input    │ ◀─RTC─── │ mouse / keyboard / nav   │
│ chrome.tabs tab control  │ ◀─RTC─── │ tab + viewport commands  │
└──────────────────────────┘          └──────────────────────────┘
```

## Built for agents, not just humans

LobsterLink includes a bridge page that runs in extension context, no popup clicking required:

```text
chrome-extension://<extension-id>/bridge.html
```

The bridge exposes everything an agent needs: start and stop hosting, get the peer ID, switch the hosted tab, launch a viewer, resize the viewport, read diagnostics. For full programmatic control:

```js
chrome.runtime.sendMessage({ action: 'startHostingCDP', tabId: 123 });
```

That starts CDP screencast mode, fully programmatic, no user gesture required. The agent starts hosting, constructs `https://lobsterl.ink/?peerId=<id>`, sends the link to the human through whatever channel makes sense, and waits.

## OpenClaw integration

This repo ships with an OpenClaw skill:

- `openclaw/lobsterlink-tab-share/SKILL.md`

### Copy-paste install prompt for OpenClaw

Use this when OpenClaw does not already have LobsterLink locally.

```text
Install and configure the unpacked LobsterLink Chrome extension for the isolated `openclaw` browser profile, then verify that it is really loaded.

Source repo:
- Public GitHub repo: `davidguttman/lobsterlink`

Assume LobsterLink is not present locally yet.
Do not git clone it.
Download the repo archive, unzip it locally, and use the extracted directory as the extension source path.

Fetch path:
1. Download the ZIP archive for `davidguttman/lobsterlink`.
2. Unzip it into a local working directory.
3. Find the extracted top-level LobsterLink directory and use its absolute path as the extension source path.

Goal:
Load this unpacked extension into the isolated `openclaw` browser via config so it survives browser restarts and can be used later by the agent.

Requirements:
- Use the isolated `openclaw` profile.
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
  - `--load-extension=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>`

Example patch target:
{
  "browser": {
    "defaultProfile": "openclaw",
    "headless": false,
    "extraArgs": [
      "--load-extension=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>"
    ]
  }
}

Execution steps:
1. Download and unzip LobsterLink locally.
2. Inspect the current config schema and current config.
3. Patch config safely.
4. Restart OpenClaw if needed so browser launch args refresh.
5. After any restart, continue the work in the same run until verification is complete.
6. Start the isolated browser profile.
7. Verify the live Chromium process includes:
   - `--user-data-dir=...openclaw...`
   - `--remote-debugging-port=...`
   - `--load-extension=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>`
8. Verify the extension is actually loaded by checking at least one of:
   - isolated profile Preferences or extension settings
   - CDP `/json/list` extension service worker or page targets
9. Discover and report the extension ID.
10. Report the exact config fields changed.

Final answer must include:
- a clear statement that setup is complete only after the post-restart verification passes
- extension source path
- whether config was updated
- whether OpenClaw/browser was restarted
- extension ID
- proof that Chromium was launched with the extension flags
- proof that the extension is loaded in the isolated profile

Do the work, do not just describe it.
```

After that, use the `lobsterlink-tab-share` skill for workflows like:

- share the LinkedIn tab
- give me the viewer link
- use my logged-in tab
- stop sharing

The skill uses the reliable path: open the bridge, start hosting via CDP, verify state, return the peer ID and public viewer link, then re-focus the hosted tab.

## Setup

1. Clone this repo.
2. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select this directory.
3. The LobsterLink icon appears in the toolbar.

Optionally, start the dev runtime for diagnostics and auto-versioning during development:

```bash
node scripts/dev-runtime.js
```

This runs a local log collector at `http://127.0.0.1:8787` and auto-stamps `manifest.json` on file changes. You can also run each piece separately:

```bash
node scripts/log-server.js
node scripts/watch-version.js
```

## Usage

**Agent (host):** Navigate to a page that needs auth, start hosting via bridge or runtime message, get the peer ID, send the human `https://lobsterl.ink/?peerId=<id>`.

**Human (viewer):** Open the link, you see the agent's tab, log in, solve the CAPTCHA, do the human thing, close the tab. The agent has the session now.

## Public web viewer

The `client/` directory is a standalone static viewer, same core as the extension, packaged so the human can connect from any browser without installing anything. This is what powers `lobsterl.ink`. See `client/README.md` for details.

## Requirements

- Chrome or Chromium on the agent's machine
- Internet for PeerJS signaling and WebRTC connectivity
- On a server, use a real display environment:

```bash
xvfb-run google-chrome --no-sandbox
```

## Troubleshooting

**"Extension is debugging this tab" infobar** , expected when `chrome.debugger` is attached. Don't dismiss it while remote control is active.

**`chrome-extension://` navigation blocked by automation tooling** , open the bridge via CDP target creation instead of normal navigation.

**Popup is open but hosting isn't running** , check bridge or runtime state directly. Popup visibility is not proof of hosting.

**No frames in screencast mode** , CDP screencast can stall on visually static pages. LobsterLink auto-restarts screencast on viewer connect and uses frame ticking to keep output alive.

**Connection fails** , both sides need to reach PeerJS signaling and successfully establish a WebRTC path.

## Diagnostics

Run the log collector to capture debugger and focus events:

```bash
node scripts/log-server.js
```

LobsterLink posts JSON events to `http://127.0.0.1:8787/log`, appended to `logs/lobsterlink-debug.jsonl`. Key events: `tab_activated`, `debugger_attach_*`, `debugger_detached_externally`, `input_dropped_*`, `host_guard_installed`. Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Permissions

- `tabs` , inspect and manage tabs
- `debugger` , inject input and run screencast via CDP
- `offscreen` , handle media and rendering work offscreen
