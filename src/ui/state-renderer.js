// ui/state-renderer.js

import { renderLobbyUI, cleanupLobbyUI } from './views/lobby-view.js'
import { renderPlayingUI, cleanupPlayingUI } from './views/playing-view.js'
import { renderEndgameUI } from './views/endgame-view.js'

let currentPhase = null

export function renderUI(gameState, context) {
  const phase = gameState.phase

  if (phase !== currentPhase) {
    // cleanup previous
    switch (currentPhase) {
      case 'lobby':
        cleanupLobbyUI()
        break
      case 'playing':
        cleanupPlayingUI()
        break
    }

    currentPhase = phase
  }

  // render current
  switch (phase) {
    case 'lobby':
      renderLobbyUI(gameState, context)
      break

    case 'playing':
      renderPlayingUI(gameState)
      break

    case 'endgame':
      renderEndgameUI(gameState, context)
      break
  }
}