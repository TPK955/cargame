import {
  PUBLIC_ORIGIN,
  RELAY_URLS,
  ROOM_APP_ID,
  TURN_CREDENTIAL,
  TURN_URLS,
  TURN_USERNAME,
} from '../game/config';
import { isLocalOrPrivateHost } from '../game/utils';

export function createRoomId() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

export function ensureRoomId() {
  const url = new URL(window.location.href);
  let nextRoomId = url.searchParams.get('room');

  if (!nextRoomId) {
    nextRoomId = createRoomId();
    url.searchParams.set('room', nextRoomId);
    window.history.replaceState({}, '', url);
  }

  return nextRoomId;
}

export function buildRoomConfig() {
  const config = {
    appId: ROOM_APP_ID,
  };

  if (RELAY_URLS.length > 0) {
    config.relayUrls = RELAY_URLS;
  }

  const turnServer = buildTurnServer();
  if (turnServer) {
    config.turnConfig = [turnServer];
  }

  return config;
}

export function buildShareUrl(roomId) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('room', roomId || ensureRoomId());

  const shareOrigin = getShareOrigin();
  if (!shareOrigin) {
    return currentUrl.toString();
  }

  const shareUrl = new URL(shareOrigin);
  shareUrl.search = currentUrl.search;
  shareUrl.hash = currentUrl.hash;
  return shareUrl.toString();
}

export function canUseMultiplayer() {
  return window.isSecureContext && typeof RTCPeerConnection !== 'undefined' && Boolean(globalThis.crypto?.subtle);
}

export function buildSecureRoomUrl(roomId) {
  const secureUrl = new URL(window.location.href);
  secureUrl.protocol = 'https:';
  secureUrl.searchParams.set('room', roomId || ensureRoomId());
  return secureUrl.toString();
}

function getShareOrigin() {
  if (PUBLIC_ORIGIN) {
    return PUBLIC_ORIGIN;
  }

  if (window.location.protocol === 'https:' && !isLocalOrPrivateHost(window.location.hostname)) {
    return window.location.origin;
  }

  return '';
}

function buildTurnServer() {
  if (TURN_URLS.length === 0) {
    return null;
  }

  return {
    urls: TURN_URLS,
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  };
}
