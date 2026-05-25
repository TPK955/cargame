# Bumper Cars P2P

## Table of Contents

1. [Overview](#overview)
2. [Current Features](#current-features)
3. [Tech Stack](#tech-stack)
4. [Getting Started](#getting-started)
5. [Environment Variables](#environment-variables)
6. [Available Scripts](#available-scripts)
7. [Multiplayer Flow](#multiplayer-flow)
8. [Controls](#controls)
9. [Gameplay Systems](#gameplay-systems)
10. [Power-Ups](#power-ups)
11. [Abilities](#abilities)
12. [Game Objective](#game-objective)
13. [Match Countdown](#match-countdown)
14. [Lobby System](#lobby-system)
15. [Map Editor](#map-editor)
16. [Networking Notes](#networking-notes)
17. [Public Hosting](#public-hosting)
18. [Build](#build)
19. [Project Structure Notes](#project-structure-notes)
20. [Current Development Status](#current-development-status)

---

## Overview

Bumper Cars P2P is a browser-based multiplayer bumper-car arena built with plain JavaScript, Vite, and Trystero over WebRTC. One peer becomes the authoritative host for gameplay simulation, while other peers send input packets and receive synchronized snapshots from the host.

The project now includes a synchronized multiplayer lobby system, host-controlled match flow, an in-game map editor, dynamic abilities and power-ups, collision combat, player life systems, pause synchronization, and multiple gameplay HUD states.

## Current Features

* Host-authoritative P2P multiplayer using Trystero's Nostr strategy and WebRTC.
* Auto-generated room URLs for fast multiplayer session sharing.
* Lobby system with:

  * player names
  * name validation
  * ready states
  * active player limits
  * host-controlled game start
* Authoritative synchronized gameplay state:

  * movement
  * collisions
  * abilities
  * power-ups
  * bombs
  * scores
  * health/lives
  * match timer
* Match countdown with synchronized start sequence and audio.
* Pause system with synchronized pause state across peers.
* Built-in map editor available during runtime for the host.
* Saved map slot support and synchronized map sharing.
* Dynamic held-ability inventory system with stackable charges.
* Endgame state with winner detection and victory messaging.
* Modular UI rendering architecture with separate lobby, gameplay, and endgame views.
* Audio system with:

  * engine sounds
  * collision sounds
  * countdown/start sounds
  * bomb sounds
  * pickup sounds
  * damage sounds
  * shield and ghost ability sounds
  * despawning sound effect
  * winning fanfare

---

# Tech Stack

* Vite
* Plain JavaScript ES Modules
* Trystero (`@trystero-p2p/nostr`)
* WebRTC
* Browser DOM/CSS rendering

---

# Getting Started

Install dependencies:

```bash
npm ci
```

Start the development server:

```bash
npm start
```

The project uses HTTPS locally by default so WebRTC and secure browser APIs work correctly.

If needed, HTTP mode can still be used for debugging:

```bash
npm start -- --http
```

---

# Environment Variables

Create a `.env` file in the project root if you want custom relay or TURN configuration.

Example:

```bash
# Optional public URL used in invite links
VITE_PUBLIC_ORIGIN=https://your-game.example.com

# Optional custom Nostr relays
VITE_NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol

# Optional TURN servers for strict NAT/firewall setups
VITE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
VITE_TURN_USERNAME=username
VITE_TURN_CREDENTIAL=password
```

If no relay configuration exists, Trystero falls back to its default relay behavior.

TURN servers are optional but improve reliability on restrictive networks such as:

* school networks
* enterprise WiFi
* carrier-grade NAT
* heavily firewalled connections

## Preferred Networks

Multiplayer may not function correctly on restricted institutional or enterprise networks due to WebRTC/STUN/TURN restrictions. **Mobile hotspot** or **home network** is recommended for testing. See [Networking Notes](#networking-notes) for more info.

---

# Available Scripts

```bash
npm start      # start Vite dev server with HTTPS
npm run build  # production build
npm run preview
```

---

# Multiplayer Flow

1. Open the game in a browser.
2. A room ID is automatically generated if one does not already exist.
3. Share the full room URL with another player.
4. Players enter unique names.
5. Players mark themselves as ready.
6. The host manually starts the match using the Play button.

The host is authoritative for:

* movement
* collisions
* life/health
* power-up validation
* timer progression
* endgame logic
* synchronized snapshots

---

# Controls

## Driving

* `W` — accelerate
* `S` — reverse
* `A` / `D` — steer

## Abilities

* `Space` — speed boost
* `Q` — activate left held ability slot
* `E` — activate right held ability slot

## UI / Match

* `Escape` — pause / resume
* `Shift + R` (host only) — force reset match
* UI buttons:

  * Ready
  * Play Game
  * Copy Invite Link
  * New Room
  * Toggle Map Editor
  * Reset Match

---

# Gameplay Systems

## Match State

The match system synchronizes:

* player positions
* velocities
* headings
* health/life
* scores
* power-ups
* bombs
* active abilities
* match timer

The HUD includes:

* HP bar
* score display
* held abilities
* boost cooldown
* pause overlay
* countdown notifications

`New Match` resets:

* lives
* scores
* positions
* momentum
* cooldowns
* abilities
* bombs
* pickups
* match timer

---

# Power-Ups

Power-ups spawn randomly on valid map tiles and are validated by the authoritative host before pickup synchronization.

## Held Ability Inventory

Players can hold up to two active pickup abilities simultaneously.

Behavior:

* duplicate pickups stack charges
* different pickups occupy separate slots
* if both slots are occupied, the oldest held pickup gets replaced

Held abilities appear in the HUD near the boost indicator.

## Current Pickup Pool

* `shield`
* `ghost`
* `bomb`
* `ice bomb`

---

# Abilities

## Speed Boost

Activated with:

```text
Space
```

Features:

* temporary acceleration multiplier
* cooldown system
* synchronized activation
* HUD cooldown display

Current tuning:

* max speed scale: `3x`
* ramp-up: `0.5s`
* duration: `2s`
* cooldown: `15s`

---

## Shield

Obtained from power-up pickups.

Features:

* collision knockback immunity
* visible shield effect
* stackable charges
* synchronized state across peers

Activated through:

* `Q`
* `E`

depending on slot position.

---

## Ghost 

Ghost is a temporary mobility ability obtained from power-up pickups.

When activated:

* the player can drive through walls
* the player can pass through other players
* collision interactions are temporarily disabled
* the effect lasts for a short duration before automatically expiring

Features:

* synchronized activation and duration across all peers
* visible gameplay state replication through host snapshots
* stored in the held-ability inventory system
* activated using `Q` or `E` depending on slot position

Ghost is designed as a high-mobility escape and repositioning ability, allowing players to bypass obstacles and crowded collisions for a limited time.

---

## Bombs

Bombs are synchronized through the host and include:

* placement state
* explosion state
* synchronized sound playback
* collision interaction

There are currently two kinds of bombs:
* Reguler Bomb which destroys floor tiles
* Ice Bomb which leaves a set of slippery ice tiles after detonation

---

# Game Objective

Crash into other players and push them off the platform to damage and eliminate them while surviving the chaos of the arena. Use movement, timing, map positioning, and power-ups strategically to outlast opponents and become the final surviving bumper car.

---

# Match Countdown

Before a match begins:

* a synchronized countdown appears for all players
* countdown sounds play each second
* a start sound triggers when gameplay begins

The countdown timing is host-driven.

---

# Lobby System

The lobby includes:

* synchronized player list
* ready states
* unique-name validation
* active player limits
* host designation
* manual match start

Players exceeding the active player limit are treated as inactive spectators until slots become available.

---

# Map Editor

The host can enter map editing mode during runtime.

Features:

* tile editing
* synchronized session maps
* saved map slots
* instant return to lobby flow after editing

The editor runs inside the same runtime session rather than as a separate application.

---

# Networking Notes

The game uses:

* WebRTC data channels for gameplay traffic
* Nostr relays for peer discovery/signaling

Some networks may block or degrade peer-to-peer connectivity.

Common problematic environments:

* school networks
* public WiFi
* enterprise firewalls
* VPNs
* strict NAT configurations

Symptoms may include:

* peers failing to join rooms
* ICE negotiation failure
* WebSocket relay errors
* intermittent connectivity

Using a TURN server improves compatibility significantly.

---

# Public Hosting

For cross-network multiplayer, the game must be hosted on a public HTTPS URL.

Railway deployment is supported with:

* Build command: `npm run build`
* Start command: `npm start`

In production (`NODE_ENV=production`), `npm start` serves the built `dist` output and binds to `PORT` automatically.

Typical cross-network multiplayer flow:

1. Open the public HTTPS URL
2. Share the room URL with players

---

# Build

```bash
npm run build
```

---

# Project Structure Notes

The runtime architecture is now split into modular systems such as:

* runtime-session
* runtime-gameplay
* runtime-editor
* runtime-match
* runtime-powerups
* lobby-controller
* UI view renderers

This separation keeps networking, gameplay, UI rendering, and editor logic isolated and easier to maintain.

---

# Current Development Status

This project is still an actively evolving prototype.

Gameplay balance, networking behavior, abilities, and power-up effects are under active iteration, and some systems are partially implemented placeholders intended for future expansion.
