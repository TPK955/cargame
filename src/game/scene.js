import {
  getActiveMap,
  mapWallToWorldRect,
  WORLD_SCALE,
  MAP_CELL_SIZE,
  MAP_WORLD_SIZE,
  MAP_ARENA_ZONE_RADIUS,
  MAP_OUTER_ZONE_RADIUS,
  MAP_INNER_ZONE_RADIUS,
} from './map-data';
import { Vec2 } from './math';

export function createWorld(root) {
  root.replaceChildren();
  root.classList.add('scene-root');
  const activeMap = getActiveMap();
  const tileSize = `${Math.ceil(MAP_CELL_SIZE * WORLD_SCALE) + 1}px`;

  const worldElement = document.createElement('div');
  worldElement.className = 'scene-world';
  root.append(worldElement);

  const mapLayer = document.createElement('div');
  mapLayer.className = 'scene-map-layer';
  worldElement.append(mapLayer);

  const outerZone = document.createElement('div');
  outerZone.className = 'arena-zone arena-zone--outer';
  mapLayer.append(outerZone);

  const innerZone = document.createElement('div');
  innerZone.className = 'arena-zone arena-zone--inner';
  innerZone.style.width = `${MAP_INNER_ZONE_RADIUS * 2 * WORLD_SCALE}px`;
  innerZone.style.height = `${MAP_INNER_ZONE_RADIUS * 2 * WORLD_SCALE}px`;
  mapLayer.append(innerZone);

  const arenaGrid = document.createElement('div');
  arenaGrid.className = 'arena-grid';
  arenaGrid.style.setProperty('--arena-grid-size', `${MAP_WORLD_SIZE * WORLD_SCALE}px`);
  arenaGrid.style.setProperty('--arena-cell-size', `${MAP_CELL_SIZE * WORLD_SCALE}px`);
  mapLayer.append(arenaGrid);

  const floorLayer = document.createElement('div');
  floorLayer.className = 'scene-map-tiles scene-map-tiles--floors';
  mapLayer.append(floorLayer);

  const iceLayer = document.createElement('div');
  iceLayer.className = 'scene-map-tiles scene-map-tiles--ice';
  mapLayer.append(iceLayer);

  const wallLayer = document.createElement('div');
  wallLayer.className = 'scene-map-tiles scene-map-tiles--walls';
  mapLayer.append(wallLayer);

  let floorEls = new Map();
  let iceEls = new Map();
  let wallEls = new Map();

  const actorLayer = document.createElement('div');
  actorLayer.className = 'scene-actor-layer';
  worldElement.append(actorLayer);

  function getTileKey(tile) {
    return `${tile.x},${tile.y}`;
  }

  function createFlatTileElement(className, tile) {
    const rect = mapWallToWorldRect(tile);
    const element = document.createElement('div');
    element.className = className;
    element.style.width = tileSize;
    element.style.height = tileSize;
    element.style.transform = `translate3d(${rect.minX * WORLD_SCALE}px, ${rect.minY * WORLD_SCALE}px, 0)`;
    return element;
  }

  function createWallElement(tile) {
    const rect = mapWallToWorldRect(tile);
    const element = document.createElement('div');
    element.className = 'arena-wall';
    element.style.width = `${(rect.maxX - rect.minX) * WORLD_SCALE}px`;
    element.style.height = `${(rect.maxY - rect.minY) * WORLD_SCALE}px`;
    element.style.transform = `translate3d(${rect.minX * WORLD_SCALE}px, ${rect.minY * WORLD_SCALE}px, 0)`;
    return element;
  }

  function syncTileLayer(layer, previousElements, tiles, createElement) {
    const nextElements = new Map();

    for (const tile of tiles) {
      const key = getTileKey(tile);
      let element = previousElements.get(key);
      if (!element) {
        element = createElement(tile);
        layer.append(element);
      }
      nextElements.set(key, element);
    }

    for (const [key, element] of previousElements.entries()) {
      if (nextElements.has(key)) {
        continue;
      }

      if (element.parentNode === layer) {
        layer.removeChild(element);
      }
    }

    return nextElements;
  }

  function renderMap(map) {
    root.dataset.arenaVariant = map.arenaVariant;

    const outerZoneRadius = map.arenaVariant === 'killzone'
      ? MAP_ARENA_ZONE_RADIUS
      : MAP_OUTER_ZONE_RADIUS;

    outerZone.style.width = `${outerZoneRadius * 2 * WORLD_SCALE}px`;
    outerZone.style.height = `${outerZoneRadius * 2 * WORLD_SCALE}px`;

    floorEls = syncTileLayer(
      floorLayer,
      floorEls,
      map.floors,
      (tile) => createFlatTileElement('arena-floor-tile', tile),
    );

    iceEls = syncTileLayer(
      iceLayer,
      iceEls,
      map.ice ?? [],
      (tile) => createFlatTileElement('arena-ice-tile', tile),
    );

    wallEls = syncTileLayer(wallLayer, wallEls, map.walls, createWallElement);
  }

  renderMap(activeMap);

  const viewPosition = new Vec2();

  const world = {
    element: worldElement,
    add(child) {
      actorLayer.append(child);
    },
    remove(child) {
      if (child?.parentNode === actorLayer) {
        actorLayer.removeChild(child);
      }
    },
    setMap(map) {
      renderMap(map);
    },
    setViewPosition(x, y) {
      viewPosition.set(x, y);
    },
    moveView(deltaX, deltaY) {
      viewPosition.x += deltaX;
      viewPosition.y += deltaY;
    },
    setSize(width, height) {
      root.style.setProperty('--viewport-width', `${width}px`);
      root.style.setProperty('--viewport-height', `${height}px`);
    },
    render() {
      worldElement.style.transform = `translate3d(${-viewPosition.x * WORLD_SCALE}px, ${-viewPosition.y * WORLD_SCALE}px, 0)`;
    },
  };

  const clock = createClock();
  world.setSize(window.innerWidth, window.innerHeight);

  return { world, clock, map: activeMap };
}

function createClock() {
  let previousTime = performance.now();

  return {
    getDelta() {
      const now = performance.now();
      const delta = (now - previousTime) / 1000;
      previousTime = now;
      return delta;
    },
  };
}