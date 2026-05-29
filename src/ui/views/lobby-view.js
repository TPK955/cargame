import { show, hide } from "../dom.js";

export function renderLobbyUI(gameState, context) {
  document.body.dataset.state = 'lobby';

  const { lobby, playHud, selfId, shortId, getActiveParticipantIds, lobbyUI } = context;

  if (!lobby || !lobbyUI) return;

  lobbyUI.render(lobby, selfId, getActiveParticipantIds, shortId, {
    isHost: typeof context.isHost === 'function' ? context.isHost() : false,
    onToggleSpawnMode: context.onToggleSpawnMode ?? null,
  });

  show("#lobby-list");
  show(".hud__card");
  show(".hud__actions");
  show("#toggle-play");
  show(".name-input-group");

  hide("#global-match-timer");
  hide("#score-display");
  hide("#hp-bar-container");
  hide('#ability-slots');
  hide('#ability-cooldown-indicator');
}

export function cleanupLobbyUI() {
  // placeholder if any cleanup needed when leaving lobby phase
}
