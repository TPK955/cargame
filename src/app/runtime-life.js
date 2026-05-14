import { LifeSystem } from '../game/life.js';

export function getPlayerLifeValue(playerLives, playerId, initialLife) {
  const life = playerLives[playerId];
  if (!life) return initialLife;

  const value = typeof life.get === 'function' ? life.get() : life.life;
  return Number.isFinite(value) ? value : initialLife;
}

export function applyLifeSnapshotForPlayer(playerLives, initialLife, playerId, playerState) {
  if (!playerState || !Object.prototype.hasOwnProperty.call(playerState, 'life')) {
    return;
  }

  if (!playerLives[playerId]) {
    playerLives[playerId] = new LifeSystem(initialLife);
  }

  const lifeSystem = playerLives[playerId];
  const nextMaxLife = Number.isFinite(playerState.maxLife) && playerState.maxLife > 0
    ? playerState.maxLife
    : (lifeSystem.maxLife || initialLife);
  lifeSystem.maxLife = nextMaxLife;

  const rawLife = Number.isFinite(playerState.life) ? playerState.life : nextMaxLife;
  lifeSystem.life = Math.max(0, Math.min(nextMaxLife, rawLife));
}

export function getHealthPercent(playerLives, peerId, initialLife) {
  const life = playerLives[peerId];
  if (!life) return 0;

  const currentLife = typeof life.getLife === 'function' ? life.getLife() : life.life;
  const maxLife = life.maxLife || initialLife;
  if (!Number.isFinite(currentLife) || !Number.isFinite(maxLife) || maxLife <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((currentLife / maxLife) * 100)));
}
