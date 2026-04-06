// Offscreen document — holds PeerJS peer + MediaStream for host mode

let peer = null;
let mediaStream = null;
let currentCall = null;
let dataConnection = null;

// Input event types that go to the debugger; everything else is a control event
const INPUT_TYPES = new Set(['mouse', 'key']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'offscreen:startHost') {
    startHost(msg.streamId, msg.tabId);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'offscreen:stopHost') {
    stopHost();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'offscreen:sendToViewer') {
    sendToViewer(msg.message);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action === 'offscreen:switchStream') {
    switchStream(msg.streamId, msg.tabId);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

function sendToViewer(message) {
  if (!dataConnection) return;
  try {
    dataConnection.send(JSON.stringify(message));
  } catch (e) {
    console.error('Failed to send to viewer:', e);
  }
}

async function startHost(streamId, tabId) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    peer = new Peer();

    peer.on('open', (id) => {
      console.log('Vipsee host peer ready:', id);
      chrome.runtime.sendMessage({ action: 'peerReady', peerId: id });
    });

    peer.on('call', (call) => {
      console.log('Incoming call from viewer');
      currentCall = call;
      call.answer(mediaStream);

      call.on('close', () => {
        console.log('Call closed');
        currentCall = null;
      });

      call.on('error', (err) => {
        console.error('Call error:', err);
      });
    });

    peer.on('connection', (conn) => {
      console.log('Data connection from viewer');
      dataConnection = conn;

      chrome.runtime.sendMessage({ action: 'viewerConnected' });

      // Send viewport info once data channel is open
      conn.on('open', () => {
        const track = mediaStream.getVideoTracks()[0];
        if (track) {
          const settings = track.getSettings();
          conn.send(JSON.stringify({
            type: 'viewport',
            width: settings.width,
            height: settings.height
          }));
        }
      });

      conn.on('data', (data) => {
        const evt = typeof data === 'string' ? JSON.parse(data) : data;

        if (INPUT_TYPES.has(evt.type)) {
          chrome.runtime.sendMessage({ action: 'inputEvent', event: evt });
        } else {
          chrome.runtime.sendMessage({ action: 'controlEvent', event: evt });
        }
      });

      conn.on('close', () => {
        console.log('Data connection closed');
        dataConnection = null;
        chrome.runtime.sendMessage({ action: 'viewerDisconnected' });
      });

      conn.on('error', (err) => {
        console.error('Data connection error:', err);
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
    });

    peer.on('disconnected', () => {
      console.log('Peer disconnected from signaling server, attempting reconnect...');
      if (peer && !peer.destroyed) {
        peer.reconnect();
      }
    });
  } catch (err) {
    console.error('Failed to start host:', err);
  }
}

async function switchStream(streamId, tabId) {
  // Get new MediaStream
  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  });

  // Stop old tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
  }
  mediaStream = newStream;

  // Replace track on the active call
  if (currentCall && currentCall.peerConnection) {
    const newTrack = newStream.getVideoTracks()[0];
    const senders = currentCall.peerConnection.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      await videoSender.replaceTrack(newTrack);
    }
  }

  // Send updated viewport
  const track = newStream.getVideoTracks()[0];
  if (track && dataConnection) {
    const settings = track.getSettings();
    sendToViewer({
      type: 'viewport',
      width: settings.width,
      height: settings.height
    });
  }
}

function stopHost() {
  if (dataConnection) {
    dataConnection.close();
    dataConnection = null;
  }
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }
}
