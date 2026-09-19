from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.continuous_worker_engine import ContinuousWorkerEngine

client = ControlPlaneClient()
engine = ContinuousWorkerEngine(client=client)
live_tasks = engine.get_live_tasks_state()

# 1. Agents status
st, agents = client._request("agents?select=id,agent_key,status,current_task_id,last_heartbeat")
print("=== 1. WORKERS STATUS (5 Registered Workers) ===")
for a in agents:
    tid = a.get("current_task_id")
    t_key = "None"
    if tid:
        for t in live_tasks.values():
            if t["id"] == tid:
                t_key = t["task_key"]
                break
    print(f"{a['agent_key']}: Status={a['status']} | Current Task={t_key}")

# 2. Task pool counts
counts = {}
for t in live_tasks.values():
    st_val = t["status"]
    counts[st_val] = counts.get(st_val, 0) + 1
print("\n=== 2. TASK POOL STATUS BREAKDOWN (49 Tasks) ===")
print(f"Total Tasks: {len(live_tasks)}")
for s, c in sorted(counts.items()):
    print(f"  {s}: {c}")

# 3. Calculate Ready vs Blocked
ready_count = 0
blocked_count = 0
for t in live_tasks.values():
    if t["status"] == "QUEUED":
        deps = engine.catalog.get(t["task_key"], {}).get("dependencies", [])
        sat = True
        for d in deps:
            if not live_tasks.get(d) or live_tasks[d]["status"] not in ["DONE", "COMPLETED"]:
                sat = False
                break
        if sat:
            ready_count += 1
        else:
            blocked_count += 1

print("\n=== 3. QUEUED BREAKDOWN ===")
print(f"  READY QUEUED Tasks: {ready_count}")
print(f"  BLOCKED QUEUED Tasks: {blocked_count}")
