// src/ui/lobby-ui.js

export function createLobbyUI(playHud) {
  const lobbyList = document.createElement('div');
  lobbyList.id = 'lobby-list';
  playHud.appendChild(lobbyList);

  function render(lobby, selfId, getActiveParticipantIds, shortId, options = {}) {
    if (!lobby) return;

    const phase = options.phase || 'lobby';
    const getHealthPercent = typeof options.getHealthPercent === 'function'
      ? options.getHealthPercent
      : null;
    const active = getActiveParticipantIds();

    lobbyList.innerHTML =
      `<p class="eyebrow">Players</p>` +
      `<div class="player-list">` +
      active.map((id) => {
        const player = lobby.state.players.get(id);
        const name = player?.name || shortId(id);
        const ready = player?.ready;
        const displayName = id === selfId ? `${name || 'You'} (You)` : name;

        const status = phase === 'playing'
          ? `${getHealthPercent ? getHealthPercent(id) : 0}% HP`
          : (ready ? 'Ready' : 'Not Ready');

        return `
          <div class="player-list__item">
            <span class="player-list__name">${displayName}</span>
            <span class="player-list__status">${status}</span>
          </div>
        `;
      }).join('') +
      `</div>`;
  }

  return { render };
}

