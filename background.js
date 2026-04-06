// Vipsee service worker — orchestrates host mode

let hostState = {
  hosting: false,
  peerId: null,
  capturedTabId: null,
  debuggerAttached: false,
  viewerConnected: false
};

// --- Message handling ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startHosting') {
    handleStartHosting().then(sendResponse);
    return true;
  }
  if (msg.action === 'stopHosting') {
    handleStopHosting().then(sendResponse);
    return true;
  }
  if (msg.action === 'getStatus') {
    sendResponse({
      hosting: hostState.hosting,
      peerId: hostState.peerId,
      viewerConnected: hostState.viewerConnected
    });
    return false;
  }
  // Messages from offscreen document
  if (msg.action === 'peerReady') {
    hostState.peerId = msg.peerId;
    return false;
  }
  if (msg.action === 'viewerConnected') {
    hostState.viewerConnected = true;
    attachDebugger(hostState.capturedTabId);
    // Send initial tab list to viewer
    sendTabListToViewer();
    return false;
  }
  if (msg.action === 'viewerDisconnected') {
    hostState.viewerConnected = false;
    detachDebugger(hostState.capturedTabId);
    return false;
  }
  if (msg.action === 'inputEvent') {
    handleInputEvent(msg.event);
    return false;
  }
  if (msg.action === 'controlEvent') {
    handleControlEvent(msg.event);
    return false;
  }
  return false;
});

// --- Host lifecycle ---

async function handleStartHosting() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { error: 'No active tab found' };

    hostState.capturedTabId = tab.id;

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

    await ensureOffscreenDocument();

    await chrome.runtime.sendMessage({
      action: 'offscreen:startHost',
      streamId,
      tabId: tab.id
    });

    const peerId = await waitForPeerId();

    hostState.hosting = true;
    hostState.peerId = peerId;

    // Start listening for tab changes
    setupTabListeners();

    return { peerId };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleStopHosting() {
  teardownTabListeners();

  try {
    await chrome.runtime.sendMessage({ action: 'offscreen:stopHost' });
  } catch (e) { /* offscreen may already be gone */ }

  await detachDebugger(hostState.capturedTabId);

  try {
    await chrome.offscreen.closeDocument();
  } catch (e) { /* may not exist */ }

  hostState = {
    hosting: false,
    peerId: null,
    capturedTabId: null,
    debuggerAttached: false,
    viewerConnected: false
  };

  return { ok: true };
}

function waitForPeerId() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Peer setup timeout')), 15000);

    function listener(msg) {
      if (msg.action === 'peerReady') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg.peerId);
      }
    }
    chrome.runtime.onMessage.addListener(listener);
  });
}

// --- Offscreen document ---

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'PeerJS connection and MediaStream for tab sharing'
  });
}

// Send a message to the viewer via the offscreen doc's data channel
function sendToViewer(message) {
  if (!hostState.viewerConnected) return;
  chrome.runtime.sendMessage({
    action: 'offscreen:sendToViewer',
    message
  }).catch(() => {}); // offscreen may be gone
}

// --- Tab management (Phase 3) ---

function onTabActivated(activeInfo) {
  if (!hostState.hosting || !hostState.viewerConnected) return;
  // When user activates a tab on the host, notify viewer
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    sendToViewer({
      type: 'tabChanged',
      tabId: tab.id,
      url: tab.url || '',
      title: tab.title || ''
    });
  });
}

function onTabUpdated(tabId, changeInfo, tab) {
  if (!hostState.hosting || !hostState.viewerConnected) return;
  // Notify viewer when tab title/url changes (for any tab, so tab list stays fresh)
  if (changeInfo.title || changeInfo.url || changeInfo.status === 'complete') {
    // If this is the captured tab, send tabChanged
    if (tabId === hostState.capturedTabId) {
      sendToViewer({
        type: 'tabChanged',
        tabId: tab.id,
        url: tab.url || '',
        title: tab.title || ''
      });
    }
    // Always refresh the full tab list so dropdown stays current
    sendTabListToViewer();
  }
}

function onTabRemoved(tabId) {
  if (!hostState.hosting || !hostState.viewerConnected) return;
  // If the captured tab was closed, we have a problem — notify viewer
  if (tabId === hostState.capturedTabId) {
    hostState.capturedTabId = null;
    hostState.debuggerAttached = false;
    sendToViewer({ type: 'status', capturing: false, tabId: null });
  }
  sendTabListToViewer();
}

function onTabCreated() {
  if (!hostState.hosting || !hostState.viewerConnected) return;
  sendTabListToViewer();
}

function setupTabListeners() {
  chrome.tabs.onActivated.addListener(onTabActivated);
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onRemoved.addListener(onTabRemoved);
  chrome.tabs.onCreated.addListener(onTabCreated);
}

function teardownTabListeners() {
  chrome.tabs.onActivated.removeListener(onTabActivated);
  chrome.tabs.onUpdated.removeListener(onTabUpdated);
  chrome.tabs.onRemoved.removeListener(onTabRemoved);
  chrome.tabs.onCreated.removeListener(onTabCreated);
}

async function sendTabListToViewer() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    sendToViewer({
      type: 'tabList',
      tabs: tabs.map(t => ({
        id: t.id,
        title: t.title || '',
        url: t.url || '',
        favIconUrl: t.favIconUrl || '',
        active: t.id === hostState.capturedTabId
      }))
    });
  } catch (e) {
    console.error('Failed to send tab list:', e);
  }
}

// --- Control message handling (Phase 3) ---

async function handleControlEvent(evt) {
  try {
    switch (evt.type) {
      case 'navigate':
        if (hostState.capturedTabId && evt.url) {
          let url = evt.url;
          if (!/^https?:\/\//i.test(url) && !url.startsWith('chrome://')) {
            url = 'https://' + url;
          }
          await chrome.tabs.update(hostState.capturedTabId, { url });
        }
        break;

      case 'goBack':
        if (hostState.capturedTabId) {
          await chrome.tabs.goBack(hostState.capturedTabId);
        }
        break;

      case 'goForward':
        if (hostState.capturedTabId) {
          await chrome.tabs.goForward(hostState.capturedTabId);
        }
        break;

      case 'reload':
        if (hostState.capturedTabId) {
          await chrome.tabs.reload(hostState.capturedTabId);
        }
        break;

      case 'listTabs':
        await sendTabListToViewer();
        break;

      case 'switchTab':
        await switchTab(evt.tabId);
        break;

      case 'newTab':
        await createNewTab(evt.url);
        break;

      case 'closeTab':
        await closeTab(evt.tabId);
        break;
    }
  } catch (err) {
    console.error('Control event error:', err, evt);
  }
}

async function switchTab(tabId) {
  if (!tabId) return;

  // Detach debugger from old tab
  await detachDebugger(hostState.capturedTabId);

  // Activate the new tab
  await chrome.tabs.update(tabId, { active: true });

  // Get new capture stream
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  hostState.capturedTabId = tabId;

  // Tell offscreen to switch streams
  await chrome.runtime.sendMessage({
    action: 'offscreen:switchStream',
    streamId,
    tabId
  });

  // Re-attach debugger
  await attachDebugger(tabId);

  // Send updated state
  const tab = await chrome.tabs.get(tabId);
  sendToViewer({
    type: 'tabChanged',
    tabId: tab.id,
    url: tab.url || '',
    title: tab.title || ''
  });
  sendToViewer({ type: 'status', capturing: true, tabId });
  await sendTabListToViewer();
}

async function createNewTab(url) {
  const createProps = {};
  if (url) {
    createProps.url = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  }
  const tab = await chrome.tabs.create(createProps);
  // Switch capture to the new tab
  // Small delay to let Chrome finish creating the tab
  setTimeout(() => switchTab(tab.id), 300);
}

async function closeTab(tabId) {
  if (!tabId) return;
  const wasCaptured = tabId === hostState.capturedTabId;
  await chrome.tabs.remove(tabId);

  if (wasCaptured) {
    // Capture the now-active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await switchTab(activeTab.id);
    }
  }
  // Tab list will be refreshed by onTabRemoved listener
}

// --- Debugger for input injection ---

async function attachDebugger(tabId) {
  if (!tabId || hostState.debuggerAttached) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    hostState.debuggerAttached = true;
  } catch (e) {
    console.error('Failed to attach debugger:', e);
  }
}

async function detachDebugger(tabId) {
  if (!tabId || !hostState.debuggerAttached) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) { /* may already be detached */ }
  hostState.debuggerAttached = false;
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === hostState.capturedTabId) {
    hostState.debuggerAttached = false;
  }
});

// --- Input injection ---

function handleInputEvent(evt) {
  const tabId = hostState.capturedTabId;
  if (!tabId || !hostState.debuggerAttached) return;

  if (evt.type === 'mouse') {
    dispatchMouseEvent(tabId, evt);
  } else if (evt.type === 'key') {
    dispatchKeyEvent(tabId, evt);
  }
}

function dispatchMouseEvent(tabId, evt) {
  const target = { tabId };

  if (evt.action === 'wheel') {
    chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: evt.x,
      y: evt.y,
      deltaX: evt.deltaX || 0,
      deltaY: evt.deltaY || 0
    });
    return;
  }

  const typeMap = {
    move: 'mouseMoved',
    down: 'mousePressed',
    up: 'mouseReleased'
  };

  const params = {
    type: typeMap[evt.action],
    x: evt.x,
    y: evt.y,
    button: evt.button || 'left',
    clickCount: evt.clickCount || (evt.action === 'down' ? 1 : 0)
  };

  if (evt.modifiers) params.modifiers = evt.modifiers;

  chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', params);
}

function dispatchKeyEvent(tabId, evt) {
  const target = { tabId };

  const typeMap = {
    down: 'keyDown',
    up: 'keyUp',
    char: 'char'
  };

  const params = {
    type: typeMap[evt.action],
    key: evt.key,
    code: evt.code,
    windowsVirtualKeyCode: evt.keyCode || 0,
    nativeVirtualKeyCode: evt.keyCode || 0
  };

  if (evt.text) params.text = evt.text;
  if (evt.unmodifiedText) params.unmodifiedText = evt.unmodifiedText;
  if (evt.modifiers) params.modifiers = evt.modifiers;

  chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', params);
}
