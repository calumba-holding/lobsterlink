# Vipsee — Remote Browser Tab Viewer

A Chrome extension for remotely viewing and controlling browser tabs via WebRTC (PeerJS).

One extension, two modes:
- **Host** — shares a tab's video stream and accepts input/control commands
- **Viewer** — connects to a host, renders the live tab, and sends mouse/keyboard input

Two capture backends:
- **tabCapture** — high fidelity, requires human click in popup (user gesture)
- **CDP screencast** — works programmatically (agent/API use), falls back automatically when tabCapture is unavailable

## Setup

1. Clone this repo
2. Optional but recommended during development: run the combined dev runtime

```bash
node scripts/dev-runtime.js
```

This starts:
- the local log collector at `http://127.0.0.1:8787`
- automatic `manifest.json` version stamping on every file change using `month.day.hour.minute`

You can still run the component scripts individually:

```bash
node scripts/log-server.js
node scripts/watch-version.js
```

3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (toggle in top-right)
5. Click **Load unpacked** and select this directory
6. The Vipsee extension icon appears in the toolbar

## Usage

### Host (remote machine)

1. Navigate to the tab you want to share
2. Click the Vipsee extension icon → **Host** → **Start Hosting**
3. The viewer auto-opens in a new window with the peer ID pre-filled
4. Share the peer ID if connecting from a different machine

### Viewer (local machine)

1. Click the Vipsee extension icon → **Viewer**
2. Paste the host's peer ID, click **Connect**
3. The viewer opens in a new window with the remote tab's live video
4. Mouse and keyboard events are forwarded to the host automatically
5. Use the nav bar: back/forward/reload, URL bar, tab dropdown, viewport selector

### Programmatic / Agent Use

Vipsee now includes a dedicated bridge tab page for browser automation:

```text
chrome-extension://<extension-id>/bridge.html
```

That page runs in extension context and is the preferred automation surface for isolated browsers or browser agents. It exposes:
- host start/stop
- current peer ID
- viewer launch/connect
- current captured tab
- tab list with start/switch actions
- viewport control
- recent diagnostics and last error

If you need direct extension-internal control, you can still start a programmatic host directly:

```js
chrome.runtime.sendMessage({ action: 'startHostingCDP', tabId: 123 });
```

Automation-only host start uses CDP `Page.startScreencast` instead of `tabCapture`.

## Requirements

- Chrome (not headless — `tabCapture` needs a headed browser)
- On servers, run Chrome under Xvfb: `xvfb-run google-chrome --no-sandbox`
- Both machines need internet access (PeerJS uses `0.peerjs.com` for signaling, then direct WebRTC)

## Troubleshooting

- **"Extension is debugging this tab" infobar** — expected when `chrome.debugger` is attached. Don't dismiss it or input injection stops.
- **Black/frozen video (same window)** — In tabCapture mode, the host tab must stay active. If the viewer is in the same window, Chrome backgrounds the host tab and freezes the stream. The popup auto-opens the viewer in a separate window to prevent this.
- **No video** — ensure the host tab is active when starting. `tabCapture` requires an active tab.
- **Connection fails** — both machines must reach `0.peerjs.com:443` and establish a direct WebRTC connection (or TURN relay). Firewalls/NAT may block this.
- **Screencast black screen** — CDP screencast only sends frames on visual changes. On static pages, frames may arrive before the viewer connects. The extension restarts the screencast on viewer connect and uses a canvas frame ticker to force continuous output.

### Local Diagnostic Logging

Run a local log collector before reproducing debugger/focus issues:

```bash
node scripts/log-server.js
```

The extension posts JSON events to `http://127.0.0.1:8787/log` and the server appends them to:

```text
logs/vipsee-debug.jsonl
```

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

```
Host (service worker + offscreen doc)     Viewer (viewer.html)
┌─────────────────────────┐               ┌─────────────────────┐
│ tabCapture / screencast  │               │ <video> element      │
│ → MediaStream (offscreen)│──RTC video──→ │ → renders live tab   │
│                          │               │                      │
│ chrome.debugger          │←─RTC data───  │ mouse/keyboard/ctrl  │
│ → Input.dispatch*        │   channel     │ → forwarded events   │
│                          │               │                      │
│ chrome.tabs.*            │←─RTC data───  │ nav bar, tab list    │
│ → tab management         │   channel     │ → control messages   │
└──────────────────────────┘               └──────────────────────┘
```

## Permissions

- `tabCapture` — capture tab video
- `tabs` — query/manage tabs
- `debugger` — inject input events + screencast via Chrome DevTools Protocol
- `activeTab` — access active tab on user gesture
- `offscreen` — create offscreen document for MediaStream handling
