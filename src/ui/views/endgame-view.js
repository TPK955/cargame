import { show, hide } from '../dom.js';

let lastEndgameSignature = '';

export function renderEndgameUI(gameState, context) {
  document.body.dataset.state = 'endgame'

  show('#lobby-list')
  show('.hud__actions')

  hide('#hp-bar-container')
  hide('#ability-slots')
  hide('#ability-cooldown-indicator')

  const lobbyList = document.getElementById('lobby-list');
  if (!lobbyList) {
    return;
  }

  const topThree = Array.isArray(gameState?.endgameResults?.topThree)
    ? gameState.endgameResults.topThree
    : [];
  const winnerName = gameState?.endgameResults?.winnerName || topThree[0]?.name || 'No winner';
  const fallbackRows = getFallbackTopThree(context);
  const rows = topThree.length > 0 ? topThree : fallbackRows;

  const isHost = context?.selfId === context?.hostId;
  const endgameSignature = JSON.stringify({
    winnerName,
    rows: rows.slice(0, 3),
    isHost,
  });

  const hasRenderedPanel = Boolean(lobbyList.querySelector('.endgame-panel'));
  if (hasRenderedPanel && endgameSignature === lastEndgameSignature) {
    return;
  }

  lobbyList.innerHTML = `
    <div class="endgame-panel">
      <p class="eyebrow">Match Over</p>
      <h2 class="endgame-panel__title">Winner: ${escapeHtml(winnerName)}</h2>
      <ol class="endgame-panel__ranking">
        ${rows.slice(0, 3).map((entry, index) => `
          <li>
            <span class="endgame-panel__place">#${index + 1}</span>
            <span class="endgame-panel__name">${escapeHtml(entry.name || 'Unknown')}</span>
            <span class="endgame-panel__score">${Number(entry.score ?? 0)} pts</span>
          </li>
        `).join('')}
      </ol>
      ${isHost ? `<button id="endgame-new-match-btn" class="endgame-panel__button">New Match</button>` : ''}
    </div>
  `;

  lastEndgameSignature = endgameSignature;

  // Attach event listener for new match button
  if (isHost) {
    const newMatchBtn = document.getElementById('endgame-new-match-btn');
    if (newMatchBtn && typeof context?.handleNewMatch === 'function') {
      newMatchBtn.onclick = context.handleNewMatch;
    }
  }
}

function getFallbackTopThree(context) {
  const lobby = context?.lobby;
  const getActiveParticipantIds = context?.getActiveParticipantIds;
  const shortId = context?.shortId;

  if (!lobby || typeof getActiveParticipantIds !== 'function') {
    return [];
  }

  return getActiveParticipantIds()
    .slice(0, 3)
    .map((id) => ({
      name: lobby.state.players.get(id)?.name || shortId?.(id) || id,
      score: 0,
    }));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}