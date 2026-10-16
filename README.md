# CYBER-GRID: Tactical Core Wars 🎮⚡

> A fast-paced, polished turn-based multiplayer tactical grid game playable by humans and autonomous AI agents in the same match. Built for the Daydreams TaskMarket bounty (`TSK-V6J8MSSD`).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-v18%2B-green.svg)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

---

## 📜 The Rules (One Paragraph)

Each match deploys 2–4 players onto a 7×7 cybernetic grid where each player controls a fortified Core node; every turn, players gain Energy (+3 base plus +1 per Data Rig, capped at 10) and execute one strategic move: **Expand** (claim adjacent empty node for 2 Energy), **Rig** (upgrade an owned node to generate bonus Energy for 4 Energy), **Shield** (fortify a node against hostile takeover for 3 Energy), **EMP** (overclock to zap enemy shields or destroy enemy rigs within range 2 for 5 Energy), or **Pass** to bank Energy; the first player to control **12 nodes**, eliminate all enemy Cores, or hold the highest territory score when Round 20 concludes claims absolute victory.

---

## ⚖️ Game Balance: The Strategic Triad (No Dominant Strategy)

CYBER-GRID eliminates dominant strategies through a cyclical rock-paper-scissors game-theoretic dynamic:
1. **Aggressive Expansion (Rush)**: Rapidly claims territory at 2 Energy per node, but leaves borders unshielded and vulnerable to enemy EMP breaches and core sniping.
2. **Heavy Fortification (Shielding)**: Renders frontlines impervious to basic captures, but consumes critical Energy (3 Energy per shield) and gets out-scaled economically by players building Data Rigs.
3. **Data Rig Engine (Economy)**: Provides massive compounding energy advantages (+1 Energy per turn per rig), but incurs heavy upfront vulnerability (4 Energy) and can be neutralized by targeted EMP bursts (5 Energy).

---

## 🚀 Quickstart & How to Run

### Zero External Dependencies
CYBER-GRID is built entirely using Node.js standard libraries (`http`, `fs`, `path`, `crypto`). No `npm install` needed!

```bash
# 1. Start the server
node server.js

# 2. Open in your web browser
# http://localhost:3000
```

### Run the Autonomous Python Bot
In a separate terminal, launch the reference autonomous agent to play against yourself or other bots:

```bash
python3 sample_bot.py
# Or join an existing match:
python3 sample_bot.py GRID-ABCD
```

---

## 🤖 Autonomous Agent HTTP / JSON REST API

AI agents interact with the game engine through clean, deterministic, zero-auth JSON REST endpoints:

### 1. Create a Match
```http
POST /api/games
Content-Type: application/json

{
  "creatorName": "Agent_Prime",
  "maxPlayers": 2,
  "autoFillBots": true
}
```
**Response (201 Created):**
```json
{
  "matchId": "GRID-8F12",
  "playerId": "P-1-a7b9",
  "playerName": "Agent_Prime",
  "status": "active"
}
```

### 2. Join an Existing Match
```http
POST /api/games/GRID-8F12/join
Content-Type: application/json

{
  "name": "Challenger_Bot",
  "isBot": true
}
```

### 3. Poll Board State & Turn Information
```http
GET /api/games/GRID-8F12/state
```
**Response (200 OK):**
```json
{
  "id": "GRID-8F12",
  "status": "active",
  "round": 3,
  "maxRounds": 20,
  "targetWinCells": 12,
  "activePlayer": {
    "id": "P-1-a7b9",
    "name": "Agent_Prime",
    "isBot": true
  },
  "players": [
    {
      "id": "P-1-a7b9",
      "name": "Agent_Prime",
      "color": "#00f0ff",
      "score": 4,
      "energy": 7,
      "alive": true,
      "isBot": true
    }
  ],
  "board": [
    [
      { "r": 0, "c": 0, "owner": "P-1-a7b9", "isCore": true, "isRig": false, "shield": 1 }
    ]
  ]
}
```

### 4. Query Legal Actions for Active Turn
```http
GET /api/games/GRID-8F12/legal?playerId=P-1-a7b9
```
**Response (200 OK):**
```json
{
  "legalActions": [
    { "action": "EXPAND", "cost": 2, "target": [0, 1], "description": "Expand to empty node at (0,1)" },
    { "action": "RIG", "cost": 4, "target": [0, 0], "description": "Deploy Data Rig at (0,0)" },
    { "action": "SHIELD", "cost": 3, "target": [0, 1], "description": "Fortify node with Shield at (0,1)" },
    { "action": "EMP", "cost": 5, "target": [2, 2], "description": "Disrupt enemy Shield at (2,2)" },
    { "action": "PASS", "cost": 0, "description": "Bank Energy (+3 Energy next turn)" }
  ]
}
```

### 5. Submit Move
```http
POST /api/games/GRID-8F12/action
Content-Type: application/json

{
  "playerId": "P-1-a7b9",
  "action": "EXPAND",
  "target": [0, 1]
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "gameOver": false
}
```

### 6. Full Replay & Historical Log Stream
```http
GET /api/games/GRID-8F12/replay
```
Returns a chronological event stream containing all board changes, energy consumptions, and attacks for post-game inspection and machine learning models.

---

## 🎨 Human Web Experience
- **Browser Play**: No account creation or installation required; instant match codes.
- **Cyberpunk UI**: Reactive neon styling, dynamic grid highlights, energy gauges, and animated turn rings.
- **Synthesizer SFX**: Native Web Audio API procedural sound effects (lasers, shields, capture alerts) with mute toggle.
- **Match Inspector**: Live event ticker tape and post-match replay viewer.

---

## 📄 License
MIT License. Open-source for human and autonomous agent communities.
