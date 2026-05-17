export function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function ensureHpBarFill() {
  let hpBarContainer = document.getElementById('hp-bar-container');
  if (!hpBarContainer) {
    hpBarContainer = document.createElement('div');
    hpBarContainer.id = 'hp-bar-container';
    hpBarContainer.innerHTML = `
      <div id="hp-bar-bg">
        <div id="hp-bar-fill"></div>
      </div>
    `;
    document.body.appendChild(hpBarContainer);
  }

  return hpBarContainer.querySelector('#hp-bar-fill');
}

export function ensureScoreDisplay() {
  let scoreDisplay = document.getElementById('score-display');
  if (!scoreDisplay) {
    scoreDisplay = document.createElement('div');
    scoreDisplay.id = 'score-display';
    document.body.appendChild(scoreDisplay);
  }

  return scoreDisplay;
}

export function updateScoreDisplay(scoreDisplayEl, entries) {
  if (!scoreDisplayEl) {
    return;
  }

  const sortedEntries = Array.isArray(entries)
    ? [...entries].sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) {
        return (b.score ?? 0) - (a.score ?? 0);
      }
      return (a.name || '').localeCompare(b.name || '');
    })
    : [];

  scoreDisplayEl.innerHTML = `
    <div class="scoreboard-title">Leaderboard</div>
    <div class="scoreboard-list">
      ${sortedEntries.map((entry) => `
        <div class="scoreboard-entry
          ${entry.isLocal ? ' scoreboard-entry--self' : ''}
          ${entry.isDead ? ' scoreboard-entry--dead' : ''}
        ">
        
          <span class="scoreboard-name">${entry.name || 'Unknown'}</span>
          <span class="scoreboard-points">
            ${entry.added > 0 ? `<span class="scoreboard-added">+${Number(entry.added)}</span>` : ''}
            <span class="scoreboard-total">${Number(entry.score ?? 0)}</span>
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

export function updateMatchTimerDisplay(matchTimerDisplay, globalMatchTimer, matchTime) {
  const formatted = formatTime(matchTime);
  if (matchTimerDisplay) {
    matchTimerDisplay.textContent = formatted;
  }

  if (globalMatchTimer) {
    globalMatchTimer.textContent = formatted;
  }
}

export function updateHpBar(hpBarFill, lifeSystem, fallbackMaxLife = 15) {
  if (!hpBarFill || !lifeSystem) {
    return;
  }

  const hp = typeof lifeSystem.getLife === 'function' ? lifeSystem.getLife() : lifeSystem.life;
  const maxHp = lifeSystem.maxLife || fallbackMaxLife;
  const percent = Math.max(0, Math.min(1, hp / maxHp));
  hpBarFill.style.width = `${percent * 100}%`;
}
