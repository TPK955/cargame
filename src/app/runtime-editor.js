import { createMapEditor } from '../game/map-editor';

export function createRuntimeEditor(options) {
  const {
    isHost,
    statusLabel,
    playHud,
    editorHud,
    toggleEditButton,
    togglePlayButton,
    gameState,
    world,
    localPlayer,
    setupInput,
    keys,
    sceneRoot,
    viewPosition,
    handleResize,
    clock,
    updateEditorView,
  } = options;

  let isEditMode = false;
  let mapEditorInstance = null;

  function mapEditorLoop() {
    if (!isEditMode) return;

    const delta = Math.min(clock.getDelta(), 0.05);
    updateEditorView(delta);
    world.render();
    requestAnimationFrame(mapEditorLoop);
  }

  function startMapEditor() {
    editorHud.innerHTML = '';

    const editorCard = document.createElement('div');
    editorCard.className = 'hud__card';
    editorHud.appendChild(editorCard);

    const ui = {
      eyebrow: document.createElement('p'),
      title: document.createElement('h1'),
      roomLabel: document.createElement('p'),
      peerCountLabel: document.createElement('p'),
      statusLabel: document.createElement('p'),
      copyLinkButton: document.createElement('button'),
      newRoomButton: document.createElement('button'),
      hintLabel: document.createElement('p'),
      actions: document.createElement('div'),
    };

    ui.eyebrow.className = 'eyebrow';
    ui.roomLabel.id = 'room-label';
    ui.peerCountLabel.id = 'peer-count';
    ui.statusLabel.id = 'status';
    ui.copyLinkButton.id = 'copy-link';
    ui.newRoomButton.id = 'new-room';
    ui.hintLabel.className = 'hint';
    ui.actions.className = 'hud__actions';

    const playButton = document.createElement('button');
    playButton.id = 'editor-toggle-play';
    playButton.textContent = 'Play Game';
    playButton.style.marginRight = '0.5rem';
    playButton.onclick = () => {
      exitEditMode();
      gameState.phase = 'playing';
    };

    ui.actions.appendChild(playButton);

    editorCard.appendChild(ui.eyebrow);
    editorCard.appendChild(ui.title);
    editorCard.appendChild(ui.roomLabel);
    editorCard.appendChild(ui.actions);
    editorCard.appendChild(ui.hintLabel);
    editorCard.appendChild(ui.peerCountLabel);
    editorCard.appendChild(ui.statusLabel);
    editorCard.appendChild(ui.copyLinkButton);
    editorCard.appendChild(ui.newRoomButton);

    if (localPlayer.group.parentNode) {
      world.remove(localPlayer.group);
    }

    const editor = createMapEditor(sceneRoot, world, ui);
    setupInput(keys);
    viewPosition.set(0, 0);
    world.setViewPosition(viewPosition.x, viewPosition.y);
    window.addEventListener('resize', handleResize);
    requestAnimationFrame(mapEditorLoop);

    return editor;
  }

  function enterEditMode() {
    if (!isHost()) {
      statusLabel.textContent = 'Only the host can use the map editor.';
      return;
    }

    isEditMode = true;
    playHud.style.display = 'none';
    editorHud.style.display = '';

    if (toggleEditButton) {
      toggleEditButton.style.display = 'none';
    }
    if (togglePlayButton) {
      togglePlayButton.style.display = '';
    }

    mapEditorInstance = startMapEditor();
  }

  function exitEditMode() {
    isEditMode = false;
    playHud.style.display = '';
    editorHud.style.display = 'none';

    if (toggleEditButton) {
      toggleEditButton.style.display = '';
    }
    if (togglePlayButton) {
      togglePlayButton.style.display = 'none';
    }

    if (mapEditorInstance && typeof mapEditorInstance.destroy === 'function') {
      mapEditorInstance.destroy();
      mapEditorInstance = null;
    }

    world.add(localPlayer.group);
    setupInput(keys);
  }

  function bindToggleButtons() {
    if (toggleEditButton) {
      toggleEditButton.addEventListener('click', () => {
        if (!isEditMode) {
          gameState.phase = 'editing';
          enterEditMode();
        }
      });
    }

    if (togglePlayButton) {
      togglePlayButton.addEventListener('click', () => {
        if (isEditMode) {
          gameState.phase = 'playing';
          exitEditMode();
        }
      });
    }
  }

  return {
    bindToggleButtons,
    enterEditMode,
    exitEditMode,
    isEditMode: () => isEditMode,
  };
}
