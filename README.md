# LobsterLink

Let a human complete blocked steps inside an agent's browser, without sharing credentials.

---

An agent opens LinkedIn, hits a login wall, and needs a human for one step. LobsterLink hosts that tab over WebRTC and gives the human a link:

```text
https://lobsterl.ink/?peerId=abc123-long-uuid
```

The human opens it, sees the agent's tab, does the required step, and leaves. The agent keeps the authenticated session.

## How it works

LobsterLink is an agent-oriented Chrome extension plus a public viewer.

**Host** , the agent's browser tab.  
**Viewer** , the human opening `lobsterl.ink`.

The host runs through CDP screencast. The viewer renders the stream and sends input back over WebRTC.

```text
Agent browser (Host)                   Human (Viewer)
┌──────────────────────────┐          ┌──────────────────────────┐
│ CDP screencast           │          │ live video render        │
│ offscreen document       │──RTC───▶ │ control surface          │
│ chrome.debugger input    │ ◀─RTC─── │ mouse / keyboard / nav   │
│ chrome.tabs tab control  │ ◀─RTC─── │ tab + viewport commands  │
└──────────────────────────┘          └──────────────────────────┘
```

## Built for agents

LobsterLink includes a bridge page that runs in extension context:

```text
chrome-extension://<extension-id>/bridge.html
```

The bridge is the control surface for agents: start and stop hosting, switch the hosted tab, read the peer ID, open the public viewer, and resize the viewport.

For programmatic control:

```js
chrome.runtime.sendMessage({ action: 'startHostingCDP', tabId: 123 });
```

That starts hosting in CDP screencast mode, returns a peer ID, and lets the agent construct the viewer URL:

```text
https://lobsterl.ink/?peerId=<id>
```

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
- `browser.extraArgs` must include:
  - `--load-extension=<ABSOLUTE_PATH_TO_EXTRACTED_LOBSTERLINK_DIRECTORY>`

Example patch target:
{
  "browser": {
    "defaultProfile": "openclaw",
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

1. Download or clone the repo locally.
2. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select this directory.
3. Open the bridge page at `chrome-extension://<extension-id>/bridge.html`, or create that target through CDP.

## Usage

1. Agent opens the target tab.
2. Agent opens `bridge.html`.
3. Agent starts hosting with `startHostingCDP` or the bridge controls.
4. Agent gets the peer ID and sends `https://lobsterl.ink/?peerId=<id>` to the human.
5. Human opens the link, completes the blocked step, and leaves.
6. Agent keeps the authenticated tab session.

## Public web viewer

The `client/` directory is the standalone static viewer that powers `lobsterl.ink`. See `client/README.md` for details.

## Requirements

- Chrome or Chromium on the agent's machine
- Internet for PeerJS signaling and WebRTC connectivity

## Troubleshooting

**`chrome-extension://` navigation blocked by automation tooling** , open the bridge via CDP target creation instead of normal navigation.

**No frames in screencast mode** , CDP screencast can stall on visually static pages. LobsterLink auto-restarts screencast on viewer connect and uses frame ticking to keep output alive.

**Connection fails** , both sides need to reach PeerJS signaling and successfully establish a WebRTC path.

## Permissions

- `tabs` , inspect and manage tabs
- `debugger` , inject input and run screencast via CDP
- `offscreen` , handle media and rendering work offscreen
