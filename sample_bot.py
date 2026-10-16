#!/usr/bin/env python3
"""
CYBER-GRID WARS — Autonomous AI Agent Reference Client
Demonstrates how an external AI agent or LLM connects via HTTP/JSON,
reads the board matrix, scores legal actions, and executes strategic turns.
"""

import sys
import time
import json
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3000"

def api_call(endpoint, method="GET", payload=None):
    url = f"{BASE_URL}{endpoint}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "CyberGrid-Agent/1.0"},
        method=method
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))

def evaluate_best_action(legal_actions, board, my_player_id):
    """
    Heuristic Strategy Evaluator:
    - Prioritizes EMP attacks against hostile shields and economic rigs (+50 pts)
    - Prioritizes capturing adjacent enemy territory (+35 pts)
    - Builds Data Rigs in safe backlines (+28 pts)
    - Fortifies border nodes (+18 pts)
    - Expands toward center grid nodes
    """
    best_act = legal_actions[0]
    best_score = -9999

    for act in legal_actions:
        score = 0
        action_type = act.get("action")
        target = act.get("target")

        if action_type == "EMP":
            score = 55
        elif action_type == "EXPAND" and target:
            r, c = target
            cell = board[r][c]
            # Extra points for stealing enemy territory
            score = 40 if cell.get("owner") else 22
            # Proximity to center (3, 3) bonus
            center_dist = abs(r - 3) + abs(c - 3)
            score -= center_dist * 2
        elif action_type == "RIG" and target:
            score = 30
        elif action_type == "SHIELD" and target:
            score = 20
        elif action_type == "PASS":
            score = 5

        if score > best_score:
            best_score = score
            best_act = act

    return best_act

def run_agent_match(match_id=None, bot_name="Agent_Alpha"):
    print(f"🤖 [AGENT BOOT] Initializing autonomous agent '{bot_name}'...")

    # 1. Create or join match
    if not match_id:
        create_res = api_call("/api/games", method="POST", payload={
            "creatorName": bot_name,
            "maxPlayers": 2,
            "autoFillBots": True
        })
        match_id = create_res["matchId"]
        player_id = create_res["playerId"]
        print(f"🎮 Created Match: {match_id} (Player ID: {player_id})")
    else:
        join_res = api_call(f"/api/games/{match_id}/join", method="POST", payload={
            "name": bot_name,
            "isBot": True
        })
        player_id = join_res["playerId"]
        print(f"🎮 Joined Match: {match_id} (Player ID: {player_id})")

    # 2. Main Game Loop
    while True:
        try:
            state = api_call(f"/api/games/{match_id}/state")
            status = state.get("status")

            if status == "finished":
                winner = state.get("winner")
                reason = state.get("winReason")
                print(f"🏁 [MATCH OVER] Winner: {winner} | Reason: {reason}")
                break

            active_player = state.get("activePlayer", {})
            active_id = active_player.get("id")

            if active_id == player_id:
                # Query legal actions
                legal_res = api_call(f"/api/games/{match_id}/legal?playerId={player_id}")
                actions = legal_res.get("legalActions", [])

                if actions:
                    best = evaluate_best_action(actions, state["board"], player_id)
                    act_type = best["action"]
                    target = best.get("target")
                    print(f"⚡ [TURN {state['round']}] Executing: {act_type} -> Target: {target} (Cost: {best['cost']} Energy)")

                    exec_res = api_call(f"/api/games/{match_id}/action", method="POST", payload={
                        "playerId": player_id,
                        "action": act_type,
                        "target": target
                    })
                    if not exec_res.get("success"):
                        print(f"⚠️ Action failed: {exec_res.get('error')}")

            time.sleep(0.8)

        except KeyboardInterrupt:
            print("\nAgent stopped by user.")
            break
        except Exception as e:
            print(f"Connection warning: {e}")
            time.sleep(1.5)

if __name__ == "__main__":
    target_match = sys.argv[1] if len(sys.argv) > 1 else None
    run_agent_match(target_match)
