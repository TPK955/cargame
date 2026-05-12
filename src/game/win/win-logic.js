export function getAlivePlayerIds(playerLives, participantIds) {
  const activeIds = Array.isArray(participantIds)
    ? participantIds
    : Array.from(participantIds ?? []);

  return activeIds.filter((id) => playerLives[id]?.isAlive?.());
}

export function shouldEndMatch(playerLives, participantIds) {
  const activeIds = Array.isArray(participantIds)
    ? participantIds
    : Array.from(participantIds ?? []);

  if (activeIds.length < 2) {
    return false;
  }

  return getAlivePlayerIds(playerLives, activeIds).length <= 1;
}

export function buildEndgameResults({
  playerLives,
  participantIds,
  getPlayerById,
  getDisplayName,
}) {
  const activeIds = Array.isArray(participantIds)
    ? participantIds
    : Array.from(participantIds ?? []);

  const ranking = activeIds
    .map((id) => {
      const player = getPlayerById(id);
      return {
        id,
        name: getDisplayName(id),
        score: Number(player?.score ?? 0) || 0,
        alive: Boolean(playerLives[id]?.isAlive?.()),
      };
    })
    .sort((a, b) => {
      if (a.alive !== b.alive) return Number(b.alive) - Number(a.alive);
      if (a.score !== b.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });

  const winner = ranking.find((entry) => entry.alive) ?? ranking[0] ?? null;

  return {
    winnerId: winner?.id ?? null,
    winnerName: winner?.name ?? 'No winner',
    topThree: ranking.slice(0, 3),
    finishedAt: performance.now() / 1000,
  };
}
