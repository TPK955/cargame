// src/lobby/lobby-state.js

export function createLobbyState(selfId) {
  return {
    players: new Map(), // id -> { name: string, ready: boolean }
    hostId: selfId,
    phase: 'lobby', // 'lobby' | 'playing'
    spawnMode: 'ordered', // 'ordered' | 'random'
    spawnOrder: [],
  };
}

export function setPlayerReady(state, playerId, ready) {
  const prev = state.players.get(playerId) || {};
  state.players.set(playerId, { ...prev, ready });
}

export function setPlayerName(state, playerId, name) {
  const prev = state.players.get(playerId) || {};
  state.players.set(playerId, { ...prev, name });
}

export function setPlayers(state, playersArray) {
  state.players.clear();
  for (const p of playersArray) {
    state.players.set(p.id, { name: p.name || '', ready: !!p.ready });
  }
}

export function allPlayersReady(state, activeIds) {
  if (activeIds.length === 0) return false;
  return activeIds.every(id => state.players.get(id)?.ready);
}