# LobsterLink — Remote Browser Tab Viewer

_2026-04-06_

## Overview

A standalone Chrome extension that lets you remotely view and control a browser tab on another machine via WebRTC. One extension, two modes: **Host** (shares a tab) and **Viewer** (connects and controls).

Primary use case: remotely browse in a VPS-hosted Chrome — log into sites, set up sessions for an AI agent, or just use the VPS as a remote browser.

## Architecture

```
Host Extension (remote Chrome)          Viewer Extension (local Chrome)
┌──────────────────────┐                ┌──────────────────────┐
│ chrome.tabCapture     │                │ <video> element       │
│ → MediaStream         │───RTC video───►│ → renders live tab    │
│                       │                │                       │
│ chrome.debugger       │◄──RTC data────│ mouse/keyboard capture│
│ → Input.dispatch*     │   channel      │ → forwards events     │
│                       │                │                       │
│ PeerJS peer (host)    │                │ PeerJS peer (viewer)  │
└───────┬──────────────┘                └───────┬──────────────┘
        │                                        │
        └──────── PeerJS signal server ──────────┘
              (SDP + ICE exchange only)
```

## Components

### Host Extension (service worker + offscreen doc)

- Registers with PeerJS, generates a peer ID
- On viewer connection:
  - `chrome.tabCapture.capture()` → MediaStream of active tab
  - Adds video track to RTCPeerConnection
  - Opens RTCDataChannel for input + control messages
- Receives input events on data channel:
  - Mouse: `chrome.debugger.sendCommand(tabId, 'Input.dispatchMouseEvent', ...)`
  - Keyboard: `chrome.debugger.sendCommand(tabId, 'Input.dispatchKeyEvent', ...)`
  - Scroll: `chrome.debugger.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', ... })`
- Tab management via data channel:
  - `listTabs` → responds with `chrome.tabs.query()` results
  - `switchTab` → stops capture, activates new tab, starts new capture, replaces RTC track
  - `newTab` → `chrome.tabs.create({ url })`, captures it
  - `closeTab` → `chrome.tabs.remove(tabId)`
  - `navigate` → `chrome.tabs.update(tabId, { url })`
  - `goBack` / `goForward` → `chrome.tabs.goBack/goForward(tabId)`

### Viewer Extension

- Popup UI or opens a full tab with the viewer
- Connect flow: enter peer ID → PeerJS connects to host
- Renders incoming video track in `<video>` element
- Captures mouse/keyboard/scroll on the video element, sends over data channel
- Coordinate mapping: video display size → remote viewport size (ratio from metadata)
- Simple nav bar: back/forward/refresh, URL field, tab dropdown
- Connection status indicator

### Data Channel Protocol

JSON messages over RTCDataChannel:

```
// Input events (viewer → host)
{ type: "mouse", action: "move"|"down"|"up"|"wheel", x, y, button?, deltaX?, deltaY?, clickCount? }
{ type: "key", action: "down"|"up"|"char", key, code, modifiers? }

// Control (viewer → host)
{ type: "navigate", url }
{ type: "goBack" }
{ type: "goForward" }
{ type: "reload" }
{ type: "switchTab", tabId }
{ type: "newTab", url? }
{ type: "closeTab", tabId }
{ type: "listTabs" }

// State (host → viewer)
{ type: "tabList", tabs: [{ id, title, url, favIconUrl, active }] }
{ type: "tabChanged", tabId, url, title }
{ type: "status", capturing: true|false, tabId }
{ type: "viewport", width, height }
```

### Signaling

- PeerJS client library in both extensions
- Default: PeerJS public server (0.peerjs.com)
- Configurable: custom PeerJS server URL in extension options
- Host generates peer ID on "Start hosting", shows it to user
- Viewer enters peer ID to connect

## Permissions (manifest.json)

```json
{
  "permissions": [
    "tabCapture",
    "tabs",
    "debugger",
    "activeTab"
  ]
}
```

- `tabCapture` — capture tab video
- `tabs` — query/manage tabs
- `debugger` — inject input events via CDP
- `activeTab` — access active tab on user gesture

## Chrome Extension Details

- **Manifest V3**
- Service worker for PeerJS connection + tab management
- Offscreen document for MediaStream handling (service workers can't hold MediaStreams; offscreen docs can)
- Viewer UI: full-tab page (chrome-extension://id/viewer.html)

## Implementation Phases

### Phase 1: Basic Connection
- Host: PeerJS setup, tabCapture, stream to RTC
- Viewer: PeerJS connect, render video in <video>
- No input, no nav bar — just "can you see the remote tab?"

### Phase 2: Input
- Mouse events (move, click, scroll) over data channel
- Keyboard events over data channel
- Host injects via chrome.debugger
- Coordinate mapping

### Phase 3: Navigation & Tabs
- Nav bar (URL, back/forward/refresh)
- Tab list/switch
- New tab / close tab

### Phase 4: Polish
- Connection status UI
- Auto-reconnect on disconnect
- Error handling (permission denied, debugger detach, etc.)
- Keyboard shortcut capture (prevent local Chrome from eating Ctrl+T etc.)

## Open Questions

- **Offscreen document lifetime**: Chrome may kill offscreen docs after inactivity. Need to keep-alive while streaming.
- **chrome.debugger infobar**: Chrome shows "Extension is debugging this tab" bar. Unavoidable but cosmetic.
- **Tab capture on non-active tabs**: `tabCapture.capture()` requires the tab to be active. `getMediaStreamId()` with a specific tabId may work for background tabs but has stricter permission requirements.
- **Headless Chrome**: `tabCapture` may not work in `--headless` mode. Requires headed Chrome (with Xvfb on servers). Document as requirement.

## Non-Goals (v1)

- Audio streaming
- File upload/download passthrough
- Clipboard sync
- Multi-viewer (one host, multiple viewers)
- Authentication beyond peer ID secrecy
- OpenClaw integration
