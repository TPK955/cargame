import { show, hide } from '../dom.js';

export function renderPlayingUI(gameState, context) {
  document.body.dataset.state = 'playing'

  if (context?.lobby && context?.lobbyUI) {
    context.lobbyUI.render(
      context.lobby,
      context.selfId,
      context.getActiveParticipantIds,
      context.shortId,
      {
        phase: 'playing',
        getHealthPercent: context.getHealthPercent,
      }
    )
  }

  show('#lobby-list')
  hide('.hud__card')
  hide('.hud__card--small')

  hide('#toggle-play')
  hide('.name-input-group')
  hide('.hud__actions')

  show('#global-match-timer')
  show('#score-display')
  show('#hp-bar-container')
  show('#ability-slots')
  show('#ability-cooldown-indicator')
}

export function cleanupPlayingUI() {
  show('.hud__card')
  hide('#ability-slots')
  hide('#ability-cooldown-indicator')
}