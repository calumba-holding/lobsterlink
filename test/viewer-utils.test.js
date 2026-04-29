import { describe, it, expect } from 'vitest';
import {
  applyHostStoppedState,
  diffMobileKeyboardText,
  getHostStoppedMessage,
  parseViewerArgs
} from '../lib/viewer-utils.js';
import * as hostedViewerUtils from '../client/lib/viewer-utils.js';

describe('diffMobileKeyboardText', () => {
  it('returns empty strings when nothing changed', () => {
    expect(diffMobileKeyboardText('hello', 'hello')).toEqual({
      removedText: '',
      insertedText: ''
    });
  });

  it('detects pure appends', () => {
    expect(diffMobileKeyboardText('hel', 'hello')).toEqual({
      removedText: '',
      insertedText: 'lo'
    });
  });

  it('detects pure deletions from the end', () => {
    expect(diffMobileKeyboardText('hello', 'hel')).toEqual({
      removedText: 'lo',
      insertedText: ''
    });
  });

  it('detects substitutions in the middle', () => {
    expect(diffMobileKeyboardText('abXYZcd', 'ab123cd')).toEqual({
      removedText: 'XYZ',
      insertedText: '123'
    });
  });

  it('detects a prefix insertion', () => {
    expect(diffMobileKeyboardText('world', 'hello world')).toEqual({
      removedText: '',
      insertedText: 'hello '
    });
  });

  it('handles transitions from empty to non-empty', () => {
    expect(diffMobileKeyboardText('', 'typed')).toEqual({
      removedText: '',
      insertedText: 'typed'
    });
  });

  it('handles transitions from non-empty to empty', () => {
    expect(diffMobileKeyboardText('typed', '')).toEqual({
      removedText: 'typed',
      insertedText: ''
    });
  });

  it('handles repeated characters around the edit site', () => {
    // Prefix match is "a"; shared suffix is "aa"; the remaining middle 'a'
    // is replaced by 'X'.
    expect(diffMobileKeyboardText('aaaa', 'aXaa')).toEqual({
      removedText: 'a',
      insertedText: 'X'
    });
  });
});

describe('parseViewerArgs', () => {
  it('reads host and debug args from the hash', () => {
    expect(parseViewerArgs('', '#host=abc123&debug=true')).toEqual({
      hostPeerId: 'abc123',
      debugEnabled: true
    });
  });

  it('prefers hash args over backward-compatible query args', () => {
    expect(parseViewerArgs('?host=query-host&debug=false', '#host=hash-host&debug=true')).toEqual({
      hostPeerId: 'hash-host',
      debugEnabled: true
    });
  });

  it('falls back to query args for old viewer links', () => {
    expect(parseViewerArgs('?host=legacy-host&debug=true', '')).toEqual({
      hostPeerId: 'legacy-host',
      debugEnabled: true
    });
  });

  it('accepts hash args that start with a question mark', () => {
    expect(parseViewerArgs('', '#?host=hash-query-host')).toEqual({
      hostPeerId: 'hash-query-host',
      debugEnabled: false
    });
  });
});


describe('host stopped viewer state', () => {
  it('uses timeout copy for timed-out shares', () => {
    expect(getHostStoppedMessage('timeout')).toBe('Share timed out. Ask the agent to start a new share.');
  });

  it('uses ended copy for manual and unknown stopped shares', () => {
    expect(getHostStoppedMessage('manual')).toBe('Share ended. Ask the agent to start a new share.');
    expect(getHostStoppedMessage('something-else')).toBe('Share ended. Ask the agent to start a new share.');
    expect(getHostStoppedMessage()).toBe('Share ended. Ask the agent to start a new share.');
  });

  it('suppresses reconnect intent and returns inactive-share UI state', () => {
    expect(applyHostStoppedState({
      connectedPeerId: 'host-peer',
      reconnectAttempts: 7,
      overlayHidden: true
    }, 'timeout')).toEqual({
      connectedPeerId: null,
      reconnectAttempts: 0,
      shouldClearReconnectTimer: true,
      shouldReconnect: false,
      overlayHidden: false,
      overlayMessage: 'Share timed out. Ask the agent to start a new share.',
      overlayError: '',
      statusText: 'Share timed out',
      statusClass: 'error'
    });
  });
});

describe('hosted viewer helper copy', () => {
  it('exports host-stopped helpers with behavior matching the extension viewer helpers', () => {
    expect(hostedViewerUtils.getHostStoppedMessage).toBeTypeOf('function');
    expect(hostedViewerUtils.applyHostStoppedState).toBeTypeOf('function');

    for (const reason of ['timeout', 'manual', undefined]) {
      expect(hostedViewerUtils.getHostStoppedMessage(reason)).toBe(getHostStoppedMessage(reason));
      expect(hostedViewerUtils.applyHostStoppedState({
        connectedPeerId: 'host-peer',
        reconnectAttempts: 3,
        overlayHidden: true
      }, reason)).toEqual(applyHostStoppedState({
        connectedPeerId: 'host-peer',
        reconnectAttempts: 3,
        overlayHidden: true
      }, reason));
    }
  });
});
