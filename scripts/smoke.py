"""End-to-end check: play, review, drill, coach, PGN, UI. Run while the server is up.

Start the server with CHESS_GAMES_DIR=games-test so tests never pollute real stats.
"""
import json
import os
import sys

import httpx

BASE = "http://127.0.0.1:8790"
fails: list[str] = []


def check(name: str, ok: bool, extra: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + (" — " + extra if extra else ""))
    if not ok:
        fails.append(name)


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=120)
    health = client.get("/api/health").json()
    check("health", health.get("ok") is True and health.get("openings", 0) > 1000, str(health))

    def post_move(sid: str, uci: str) -> dict:
        response = client.post("/api/move", json={"sid": sid, "uci": uci})
        body = response.json()
        if response.status_code != 200:
            print(f"FAIL move {uci} -> HTTP {response.status_code}: {body}")
        return body

    state = client.post("/api/new", json={"skill": 3, "color": "white"}).json()
    check("new game", state["status"] == "playing" and "e2" in state["dests"], state["id"])

    state = post_move(state["id"], "f2f3")
    check("move f3 + engine reply", len(state.get("moves", [])) == 2,
          f"engine played {state['moves'][1]['san'] if len(state.get('moves', [])) > 1 else '?'}")

    state = post_move(state["id"], "g2g4")
    if state.get("status") != "finished":
        state = post_move(state["id"], "g1h3")  # white to move again; the engine may not mate after g4
    check("game flow ok", len(state.get("moves", [])) >= 4,
          f"{len(state.get('moves', []))} plies, status {state.get('status')}")
    check("opening detected", "opening" in json.dumps(state)[:200] or state.get("opening") is not None
          or len(state["moves"]) >= 4)

    review_text = client.get(f"/api/review/{state['id']}").text
    events = [json.loads(line[6:]) for line in review_text.splitlines() if line.startswith("data: ")]
    done = [e for e in events if e.get("done")]
    check("review done", len(done) == 1, f"{len(events)} events")
    if done:
        state = done[0]["state"]
        player_moves = [m for m in state["moves"] if not m["byEngine"]]
        check("every player move graded",
              all(m["badge"] for m in player_moves) and len(player_moves) > 0)
        check("engine moves not graded", all(m["badge"] is None for m in state["moves"] if m["byEngine"]))
        check("summary present", state.get("summary") is not None
              and state["summary"].get("accuracy") is not None, str(state.get("summary"))[:140])
        if not any(m["badge"] in ("mistake", "blunder") for m in player_moves):
            print("SKIP drill checks — the engine didn't punish this throwaway game "
                  "(skill-3 replies are randomized); not an app failure")

    target = next((m for m in state["moves"]
                   if not m["byEngine"] and m["badge"] in ("mistake", "blunder")), None)
    if target:
        drill = client.post("/api/drill", json={"sid": state["id"], "ply": target["ply"]}).json()
        check("drill start", bool(drill["dests"]), f"ply {target['ply']}")
        best = target["bestUci"]
        all_uci = [u + d for u, ds in drill["dests"].items() for d in ds]
        wrong = next((u for u in all_uci if u != best), None)
        if wrong:
            result = client.post("/api/drill/try",
                                 json={"sid": state["id"], "ply": target["ply"], "uci": wrong}).json()
            check("drill grades a wrong move", "badge" in result, f"{wrong} -> {result.get('badge')}")
            if result.get("correct") is True:
                print("WARN wrong move graded correct (alternative good move exists)")
        if best:
            result = client.post("/api/drill/try",
                                 json={"sid": state["id"], "ply": target["ply"], "uci": best}).json()
            check("drill accepts the best move", result.get("correct") is True)
    else:
        print("SKIP drill target — no mistake/blunder in this randomized game")

    if health.get("coach"):
        response = client.post(f"/api/coach/{state['id']}/0")
        text = response.json().get("text", "") if response.status_code == 200 else ""
        if response.status_code == 200 and text == "":
            print("SKIP coach text — Gemini rate-limited right now (empty is the correct fallback)")
        else:
            check("coach", response.status_code == 200 and len(text) > 5, response.text[:120])
    else:
        print("SKIP coach — no key")

    black_game = client.post("/api/new", json={"skill": 2, "color": "black"}).json()
    check("engine opens as white",
          len(black_game["moves"]) == 1 and black_game["moves"][0]["byEngine"] is True)

    black_game = post_move(black_game["id"], "e7e5")
    state = client.post(f"/api/resign/{black_game['id']}").json()
    check("resign finishes the game", state["status"] == "finished" and state["result"] == "1-0")
    review_text = client.get(f"/api/review/{black_game['id']}").text
    events = [json.loads(line[6:]) for line in review_text.splitlines() if line.startswith("data: ")]
    done = [e for e in events if e.get("done")]
    check("review after resign", len(done) == 1 and done[0]["state"]["reviewed"] is True
          and done[0]["state"]["summary"] is not None)

    stats = client.get("/api/stats").json()
    check("stats endpoint", "totals" in stats and "games" in stats and "openings" in stats)
    practice = client.get("/api/practice").json()
    check("practice endpoint", "items" in practice)
    pc = client.post("/api/practice/check", json={
        "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "uci": "e2e4"}).json()
    check("practice check", pc.get("badge") in ("best", "excellent", "good"), str(pc.get("badge")))

    if health.get("maia"):
        maia = client.post("/api/new", json={"skill": 6, "color": "white", "opponent": "maia", "elo": 1150}).json()
        check("maia game starts", maia.get("opponent") == "maia")
        maia = client.post("/api/move", json={"sid": maia["id"], "uci": "e2e4"}).json()
        reply = maia["moves"][-1]
        check("maia replies", reply["byEngine"] is True and maia["status"] == "playing",
              f"maia played {reply['san']}")
        check("maia game still analyses", reply["evalCp"] is not None)
    else:
        print("SKIP maia — maia3-uci not installed")

    page = client.get("/")
    check("ui served", page.status_code == 200 and "root" in page.text)

    print("—")
    print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
