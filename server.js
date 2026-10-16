const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-Memory Game Store
const games = new Map();

// Helper: Generate short readable ID
function generateId(prefix = 'GAME') {
  return `${prefix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// Player configuration presets
const PLAYER_CONFIGS = [
  { color: '#00f0ff', name: 'Alpha (Cyan)', start: [0, 0] },
  { color: '#ff0055', name: 'Omega (Magenta)', start: [6, 6] },
  { color: '#00ff66', name: 'Viper (Emerald)', start: [0, 6] },
  { color: '#ffb700', name: 'Solar (Amber)', start: [6, 0] }
];

// Create a new match state
function createGame(options = {}) {
  const id = generateId('GRID');
  const maxPlayers = Math.min(4, Math.max(2, parseInt(options.maxPlayers) || 2));
  const autoFillBots = options.autoFillBots !== false;

  // Initialize 7x7 board
  const board = [];
  for (let r = 0; r < 7; r++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      row.push({
        r,
        c,
        owner: null,
        isCore: false,
        isRig: false,
        shield: 0
      });
    }
    board.push(row);
  }

  const game = {
    id,
    status: 'waiting', // waiting, active, finished
    createdAt: Date.now(),
    maxPlayers,
    players: [],
    turnIndex: 0,
    round: 1,
    maxRounds: 20,
    targetWinCells: 12,
    board,
    events: [],
    winner: null,
    winReason: null
  };

  // Add creator
  const creatorName = (options.creatorName || 'Player 1').trim().slice(0, 20);
  addPlayer(game, creatorName, false);

  if (autoFillBots) {
    while (game.players.length < maxPlayers) {
      addPlayer(game, `AI-Sentinel-${game.players.length}`, true);
    }
    startGame(game);
  }

  games.set(id, game);
  return game;
}

function addPlayer(game, name, isBot = false) {
  if (game.players.length >= game.maxPlayers || game.status !== 'waiting') {
    return null;
  }

  const idx = game.players.length;
  const cfg = PLAYER_CONFIGS[idx];
  const playerId = `P-${idx + 1}-${crypto.randomBytes(2).toString('hex')}`;

  const player = {
    id: playerId,
    index: idx,
    name,
    isBot,
    color: cfg.color,
    core: cfg.start,
    energy: 6,
    score: 1,
    alive: true
  };

  // Claim core node
  const [cr, cc] = cfg.start;
  game.board[cr][cc].owner = playerId;
  game.board[cr][cc].isCore = true;
  game.board[cr][cc].shield = 1;

  game.players.push(player);
  game.events.push({
    type: 'PLAYER_JOINED',
    player: name,
    playerId,
    isBot,
    timestamp: Date.now()
  });

  return player;
}

function startGame(game) {
  if (game.status !== 'waiting' || game.players.length < 2) return;
  game.status = 'active';
  game.turnIndex = 0;
  game.round = 1;
  game.events.push({
    type: 'GAME_STARTED',
    players: game.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot })),
    timestamp: Date.now()
  });

  checkBotTurn(game);
}

// Calculate legal actions for active player
function getLegalActions(game, playerId) {
  const p = game.players.find(x => x.id === playerId);
  if (!p || !p.alive || game.status !== 'active') return [];

  const legal = [{ action: 'PASS', cost: 0, description: 'Bank Energy (+3 Energy next turn)' }];
  const ownedNodes = [];

  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (game.board[r][c].owner === playerId) {
        ownedNodes.push([r, c]);
      }
    }
  }

  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1], // Orthogonal
    [-1, -1], [-1, 1], [1, -1], [1, 1] // Diagonal
  ];

  // 1. EXPAND (Cost: 2 Energy)
  if (p.energy >= 2) {
    const visited = new Set();
    for (const [or, oc] of ownedNodes) {
      for (const [dr, dc] of dirs) {
        const nr = or + dr;
        const nc = oc + dc;
        const key = `${nr},${nc}`;
        if (nr >= 0 && nr < 7 && nc >= 0 && nc < 7 && !visited.has(key)) {
          visited.add(key);
          const cell = game.board[nr][nc];
          if (cell.owner !== playerId && cell.shield === 0) {
            legal.push({
              action: 'EXPAND',
              cost: 2,
              target: [nr, nc],
              description: cell.owner ? `Capture enemy node at (${nr},${nc})` : `Expand to empty node at (${nr},${nc})`
            });
          }
        }
      }
    }
  }

  // 2. RIG (Cost: 4 Energy)
  if (p.energy >= 4) {
    for (const [or, oc] of ownedNodes) {
      const cell = game.board[or][oc];
      if (!cell.isRig && !cell.isCore) {
        legal.push({
          action: 'RIG',
          cost: 4,
          target: [or, oc],
          description: `Deploy Data Rig at (${or},${oc}) (+1 Energy/turn)`
        });
      }
    }
  }

  // 3. SHIELD (Cost: 3 Energy)
  if (p.energy >= 3) {
    for (const [or, oc] of ownedNodes) {
      const cell = game.board[or][oc];
      if (cell.shield === 0) {
        legal.push({
          action: 'SHIELD',
          cost: 3,
          target: [or, oc],
          description: `Fortify node with Shield at (${or},${oc})`
        });
      }
    }
  }

  // 4. EMP (Cost: 5 Energy, Range: 2)
  if (p.energy >= 5) {
    const visited = new Set();
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = game.board[r][c];
        if (cell.owner && cell.owner !== playerId && (cell.shield > 0 || cell.isRig)) {
          // Check Manhattan distance <= 2 to any owned node
          const inRange = ownedNodes.some(([or, oc]) => Math.abs(or - r) + Math.abs(oc - c) <= 2);
          if (inRange && !visited.has(`${r},${c}`)) {
            visited.add(`${r},${c}`);
            legal.push({
              action: 'EMP',
              cost: 5,
              target: [r, c],
              description: `Disrupt enemy ${cell.shield > 0 ? 'Shield' : 'Rig'} at (${r},${c})`
            });
          }
        }
      }
    }
  }

  return legal;
}

// Execute player action
function executeAction(game, playerId, actionType, target) {
  if (game.status !== 'active') return { success: false, error: 'Match is not active' };

  const activePlayer = game.players[game.turnIndex];
  if (!activePlayer || activePlayer.id !== playerId) {
    return { success: false, error: 'Not your turn' };
  }

  const legal = getLegalActions(game, playerId);
  const matched = legal.find(l => {
    if (l.action !== actionType) return false;
    if (l.target && target) {
      return l.target[0] === target[0] && l.target[1] === target[1];
    }
    return true;
  });

  if (!matched) {
    return { success: false, error: 'Illegal action or insufficient energy' };
  }

  // Deduct cost
  activePlayer.energy -= matched.cost;
  let eventDetail = {
    action: actionType,
    player: activePlayer.name,
    playerId,
    cost: matched.cost,
    target,
    timestamp: Date.now()
  };

  // Perform mechanics
  if (actionType === 'EXPAND') {
    const [tr, tc] = target;
    const cell = game.board[tr][tc];
    const prevOwnerId = cell.owner;
    cell.owner = playerId;
    cell.shield = 0; // Freshly captured has 0 shield
    cell.isRig = false; // Destroy previous rig on capture

    eventDetail.previousOwner = prevOwnerId;
  } else if (actionType === 'RIG') {
    const [tr, tc] = target;
    game.board[tr][tc].isRig = true;
  } else if (actionType === 'SHIELD') {
    const [tr, tc] = target;
    game.board[tr][tc].shield = 1;
  } else if (actionType === 'EMP') {
    const [tr, tc] = target;
    const cell = game.board[tr][tc];
    if (cell.shield > 0) {
      cell.shield = 0;
      eventDetail.effect = 'Shield breached';
    } else if (cell.isRig) {
      cell.isRig = false;
      eventDetail.effect = 'Data Rig destroyed';
    }
  }

  game.events.push(eventDetail);

  // Recalculate scores and check win conditions
  updateScores(game);
  const checkWin = evaluateGameOver(game);
  if (checkWin.gameOver) {
    game.status = 'finished';
    game.winner = checkWin.winner;
    game.winReason = checkWin.reason;
    game.events.push({
      type: 'GAME_OVER',
      winner: checkWin.winner,
      reason: checkWin.reason,
      timestamp: Date.now()
    });
    return { success: true, gameOver: true, winner: checkWin.winner };
  }

  // Advance turn
  advanceTurn(game);
  return { success: true, gameOver: false };
}

function updateScores(game) {
  const counts = {};
  for (const p of game.players) counts[p.id] = 0;

  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const o = game.board[r][c].owner;
      if (o && counts[o] !== undefined) {
        counts[o]++;
      }
    }
  }

  for (const p of game.players) {
    p.score = counts[p.id] || 0;
    // Core check
    const [cr, cc] = p.core;
    if (game.board[cr][cc].owner !== p.id) {
      p.alive = false;
    }
  }
}

function evaluateGameOver(game) {
  // 1. Check territory dominance (>= 12 cells)
  for (const p of game.players) {
    if (p.alive && p.score >= game.targetWinCells) {
      return { gameOver: true, winner: p.name, reason: `Dominance: Controlled ${p.score} nodes (target ${game.targetWinCells})` };
    }
  }

  // 2. Check last player alive
  const alivePlayers = game.players.filter(p => p.alive);
  if (alivePlayers.length === 1) {
    return { gameOver: true, winner: alivePlayers[0].name, reason: 'Total Annihilation: Destroyed all enemy Cores' };
  }
  if (alivePlayers.length === 0) {
    return { gameOver: true, winner: 'Draw', reason: 'Mutual annihilation' };
  }

  // 3. Max rounds reached (Round 20)
  if (game.round > game.maxRounds) {
    alivePlayers.sort((a, b) => b.score - a.score);
    if (alivePlayers[0].score === (alivePlayers[1] ? alivePlayers[1].score : -1)) {
      return { gameOver: true, winner: 'Draw', reason: `Turn limit reached (Round ${game.maxRounds}): Tied at ${alivePlayers[0].score} nodes` };
    }
    return { gameOver: true, winner: alivePlayers[0].name, reason: `Turn limit reached: High score ${alivePlayers[0].score} nodes` };
  }

  return { gameOver: false };
}

function advanceTurn(game) {
  let nextIdx = (game.turnIndex + 1) % game.players.length;
  if (nextIdx === 0) {
    game.round++;
  }

  // Find next living player
  let loops = 0;
  while (!game.players[nextIdx].alive && loops < game.players.length) {
    nextIdx = (nextIdx + 1) % game.players.length;
    loops++;
  }

  game.turnIndex = nextIdx;
  const p = game.players[nextIdx];

  // Energy regeneration: +3 base + 1 per Rig (cap at 10)
  let rigBonus = 0;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (game.board[r][c].owner === p.id && game.board[r][c].isRig) {
        rigBonus++;
      }
    }
  }
  p.energy = Math.min(10, p.energy + 3 + rigBonus);

  checkBotTurn(game);
}

function checkBotTurn(game) {
  if (game.status !== 'active') return;
  const p = game.players[game.turnIndex];
  if (p && p.isBot && p.alive) {
    setTimeout(() => {
      runAutonomousBotMove(game, p.id);
    }, 400);
  }
}

// Built-in autonomous heuristics bot
function runAutonomousBotMove(game, botId) {
  if (game.status !== 'active') return;
  const legal = getLegalActions(game, botId);
  if (!legal || legal.length === 0) return;

  // Heuristic evaluation
  let best = legal[0];
  let maxScore = -999;

  for (const act of legal) {
    let s = 0;
    if (act.action === 'EXPAND') {
      const [r, c] = act.target;
      const targetCell = game.board[r][c];
      s += targetCell.owner ? 35 : 20; // Stealing enemy territory preferred
      // Prefer center nodes (dist from 3,3)
      s -= (Math.abs(r - 3) + Math.abs(c - 3)) * 2;
    } else if (act.action === 'EMP') {
      s += 45; // High priority disrupt
    } else if (act.action === 'RIG') {
      s += 25; // Economic expansion
    } else if (act.action === 'SHIELD') {
      s += 18; // Defense
    } else if (act.action === 'PASS') {
      s = 5;
    }

    if (s > maxScore) {
      maxScore = s;
      best = act;
    }
  }

  executeAction(game, botId, best.action, best.target);
}

// ==============================================================================
// HTTP Request Handlers & API Routing
// ==============================================================================

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // REST API Endpoints
  // 1. List Public Matches
  if (req.method === 'GET' && pathname === '/api/games') {
    const list = Array.from(games.values()).map(g => ({
      id: g.id,
      status: g.status,
      round: g.round,
      players: g.players.map(p => ({ name: p.name, score: p.score, isBot: p.isBot })),
      maxPlayers: g.maxPlayers,
      createdAt: g.createdAt
    }));
    return sendJson(res, 200, { games: list });
  }

  // 2. Create Match
  if (req.method === 'POST' && pathname === '/api/games') {
    const body = await parseBody(req);
    const game = createGame(body);
    const hostPlayer = game.players[0];
    return sendJson(res, 201, {
      matchId: game.id,
      playerId: hostPlayer.id,
      playerName: hostPlayer.name,
      status: game.status
    });
  }

  // 3. Join Match
  const joinMatch = pathname.match(/^\/api\/games\/([^/]+)\/join$/);
  if (req.method === 'POST' && joinMatch) {
    const gameId = joinMatch[1];
    const game = games.get(gameId);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const body = await parseBody(req);
    const name = (body.name || `Player-${game.players.length + 1}`).slice(0, 20);
    const isBot = Boolean(body.isBot);
    const player = addPlayer(game, name, isBot);
    if (!player) return sendJson(res, 400, { error: 'Game is full or already active' });

    if (game.players.length === game.maxPlayers) {
      startGame(game);
    }
    return sendJson(res, 200, {
      matchId: game.id,
      playerId: player.id,
      name: player.name,
      status: game.status
    });
  }

  // 4. Poll Match State
  const stateMatch = pathname.match(/^\/api\/games\/([^/]+)\/state$/);
  if (req.method === 'GET' && stateMatch) {
    const gameId = stateMatch[1];
    const game = games.get(gameId);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });

    const activePlayer = game.players[game.turnIndex];
    return sendJson(res, 200, {
      id: game.id,
      status: game.status,
      round: game.round,
      maxRounds: game.maxRounds,
      targetWinCells: game.targetWinCells,
      activePlayer: activePlayer ? { id: activePlayer.id, name: activePlayer.name, isBot: activePlayer.isBot } : null,
      players: game.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        energy: p.energy,
        alive: p.alive,
        isBot: p.isBot
      })),
      board: game.board,
      winner: game.winner,
      winReason: game.winReason,
      lastEvent: game.events[game.events.length - 1] || null
    });
  }

  // 5. Query Legal Actions for Player
  const legalMatch = pathname.match(/^\/api\/games\/([^/]+)\/legal$/);
  if (req.method === 'GET' && legalMatch) {
    const gameId = legalMatch[1];
    const game = games.get(gameId);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const playerId = parsed.query.playerId;
    if (!playerId) return sendJson(res, 400, { error: 'Missing playerId query param' });

    const actions = getLegalActions(game, playerId);
    return sendJson(res, 200, { legalActions: actions });
  }

  // 6. Submit Action
  const actionMatch = pathname.match(/^\/api\/games\/([^/]+)\/action$/);
  if (req.method === 'POST' && actionMatch) {
    const gameId = actionMatch[1];
    const game = games.get(gameId);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    const body = await parseBody(req);
    const { playerId, action, target } = body;
    if (!playerId || !action) return sendJson(res, 400, { error: 'Missing playerId or action' });

    const result = executeAction(game, playerId, action, target);
    if (!result.success) {
      return sendJson(res, 400, result);
    }
    return sendJson(res, 200, result);
  }

  // 7. Get Replay / Event Logs
  const replayMatch = pathname.match(/^\/api\/games\/([^/]+)\/replay$/);
  if (req.method === 'GET' && replayMatch) {
    const gameId = replayMatch[1];
    const game = games.get(gameId);
    if (!game) return sendJson(res, 404, { error: 'Game not found' });
    return sendJson(res, 200, { id: game.id, events: game.events });
  }

  // Serve Static Frontend Files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('File not found');
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Cyber-Grid Wars Server running on http://0.0.0.0:${PORT}`);
});
