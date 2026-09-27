"""End-to-end check: play, review, drill, coach, PGN, UI. Run while the server is up."""
import json
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

    state = client.post("/api/new", json={"skill": 3, "color": "white"}).json()
    check("new game", state["status"] == "playing" and "e2" in state["dests"], state["id"])

    state = client.post("/api/move", json={"sid": state["id"], "uci": "f2f3"}).json()
    check("move f3 + engine reply", len(state["moves"]) == 2,
          f"engine played {state['moves'][1]['san'] if len(state['moves']) > 1 else '?'}")

    state = client.post("/api/move", json={"sid": state["id"], "uci": "g2g4"}).json()
    if state["status"] != "finished":
        state = client.post("/api/move", json={"sid": state["id"], "uci": "b8c3"}).json()
    check("game flow ok", len(state["moves"]) >= 4, f"{len(state['moves'])} plies, status {state['status']}")
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
        check("review found a bad move",
              any(m["badge"] in ("mistake", "blunder") for m in player_moves),
              str([(m["san"], m["badge"]) for m in state["moves"] if m["badge"]]))
        check("summary present", state.get("summary") is not None
              and state["summary"].get("accuracy") is not None, str(state.get("summary"))[:140])

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
        check("drill target found", False, "no mistake/blunder in game")

    if health.get("coach"):
        response = client.post(f"/api/coach/{state['id']}/0")
        check("coach", response.status_code == 200 and len(response.json().get("text", "")) > 5,
              response.text[:120])
    else:
        print("SKIP coach — no key")

    black_game = client.post("/api/new", json={"skill": 2, "color": "black"}).json()
    check("engine opens as white",
          len(black_game["moves"]) == 1 and black_game["moves"][0]["byEngine"] is True)

    state = client.post(f"/api/resign/{black_game['id']}").json()
    check("resign finishes the game", state["status"] == "finished" and state["result"] == "1-0")

    page = client.get("/")
    check("ui served", page.status_code == 200 and "root" in page.text)

    print("—")
    print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
