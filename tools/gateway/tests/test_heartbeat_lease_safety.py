"""
Regression Test: Worker Heartbeat Lease Safety.
Verifies that worker heartbeats preserve the database as the source of truth:
1. Agent starts AVAILABLE
2. Agent claims a task (status becomes WORKING)
3. 3 consecutive heartbeats are sent (with worker_state=None)
4. Verify agent status REMAINS 'WORKING' after every heartbeat
5. Verify current_task_id remains unchanged
6. Verify lease remains valid
7. After expiration / task cleanup, verify state returns to normal
"""

import time
import json
import urllib.request
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))


from tools.gateway.gateway import CapabilityGateway
from tools.gateway.auth import GatewayAuth
from tools.gateway.vault import SecretVault

def run_regression_test():
    gw = CapabilityGateway()
    auth = GatewayAuth()
    vault = SecretVault()
    w_token = auth.get_token_for_role("worker")

    key = vault.get("SUPABASE_SERVICE_ROLE_KEY") or vault.get("SUPABASE_KEY")
    base = vault.get("SUPABASE_URL")

    # Step A: Choose Agent 02 and a QUEUED task
    agent_id = "79de33a3-fab1-42eb-b026-6896a69a04e2"
    agent_key = "arena-agent-02-engine"

    # Fetch queued task
    url_t = f"{base}/rest/v1/tasks?status=eq.QUEUED&specialization_id=eq.c36b4db7-0ea7-4688-a4bc-b4e5487704b8&limit=1&select=id,task_key,version"
    req_t = urllib.request.Request(url_t, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req_t) as r:
        tasks = json.loads(r.read())
    assert len(tasks) > 0, "No QUEUED task found for engine specialization"
    task = tasks[0]
    task_id = task["id"]
    task_key = task["task_key"]
    version = task["version"]
    print(f"[REGRESSION] Target Task: {task_key} ({task_id}), Version: {version}")

    # Ensure agent starts AVAILABLE
    url_a = f"{base}/rest/v1/agents?id=eq.{agent_id}"
    req_reset = urllib.request.Request(url_a, data=json.dumps({"status": "AVAILABLE", "current_task_id": None}).encode(), headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="PATCH")
    with urllib.request.urlopen(req_reset):
        pass

    # Verify Agent is AVAILABLE (Step A)
    with urllib.request.urlopen(urllib.request.Request(f"{url_a}&select=status", headers={"apikey": key, "Authorization": f"Bearer {key}"})) as r:
        initial_status = json.loads(r.read())[0]["status"]
    print(f"[REGRESSION] Step A: Initial Agent Status = {initial_status}")
    assert initial_status == "AVAILABLE"

    # Step B: Claim task lease
    claim_res = gw.invoke(
        caller_id=agent_key,
        capability="supabase.claim_task_lease",
        params={
            "task_id": task_id,
            "agent_id": agent_id,
            "expected_version": version,
            "lease_seconds": 120
        },
        bearer_token=w_token
    )
    print(f"[REGRESSION] Step B: Claim result = {claim_res.get('ok')} -> {claim_res.get('result', {}).get('status')}")
    assert claim_res.get("ok"), f"Claim failed: {claim_res}"

    # Step C: Verify agent is WORKING in DB
    with urllib.request.urlopen(urllib.request.Request(f"{url_a}&select=status,current_task_id", headers={"apikey": key, "Authorization": f"Bearer {key}"})) as r:
        agent_data = json.loads(r.read())[0]
    print(f"[REGRESSION] Step C: DB Agent Status = {agent_data['status']}, current_task_id = {agent_data['current_task_id']}")
    assert agent_data["status"] == "WORKING"
    assert agent_data["current_task_id"] == task_id

    # Step D & E: Send 3 consecutive heartbeats (supervisor behavior: worker_state=None)
    for i in range(1, 4):
        hb_res = gw.invoke(
            caller_id=agent_key,
            capability="supabase.worker_heartbeat",
            params={
                "agent_id": agent_id,
                "worker_state": None,
                "current_task_id": None
            },
            bearer_token=w_token
        )
        assert hb_res.get("ok"), f"Heartbeat {i} failed: {hb_res}"

        # Verify DB status
        with urllib.request.urlopen(urllib.request.Request(f"{url_a}&select=status,current_task_id", headers={"apikey": key, "Authorization": f"Bearer {key}"})) as r:
            curr_data = json.loads(r.read())[0]
        print(f"[REGRESSION] Step D/E (Pulse {i}): Status = {curr_data['status']}, current_task_id = {curr_data['current_task_id']}")
        assert curr_data["status"] == "WORKING", f"VIOLATION: Status flipped to {curr_data['status']} on pulse {i}!"
        assert curr_data["current_task_id"] == task_id, "VIOLATION: current_task_id was corrupted!"
        time.sleep(1)

    # Step F & G: Verify task lease remains valid in tasks table
    with urllib.request.urlopen(urllib.request.Request(f"{base}/rest/v1/tasks?id=eq.{task_id}&select=status,assigned_agent_id,lease_expires_at", headers={"apikey": key, "Authorization": f"Bearer {key}"})) as r:
        t_data = json.loads(r.read())[0]
    print(f"[REGRESSION] Step F/G: Task status = {t_data['status']}, assigned = {t_data['assigned_agent_id']}, lease = {t_data['lease_expires_at']}")
    assert t_data["status"] == "CLAIMED"
    assert t_data["assigned_agent_id"] == agent_id

    # Step H: Clean up / Revert task to QUEUED and agent to AVAILABLE
    req_task_rev = urllib.request.Request(f"{base}/rest/v1/tasks?id=eq.{task_id}", data=json.dumps({"status": "QUEUED", "assigned_agent_id": None, "lease_expires_at": None}).encode(), headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="PATCH")
    with urllib.request.urlopen(req_task_rev):
        pass

    req_ag_rev = urllib.request.Request(url_a, data=json.dumps({"status": "AVAILABLE", "current_task_id": None}).encode(), headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="PATCH")
    with urllib.request.urlopen(req_ag_rev):
        pass

    print("[REGRESSION] Step H: Clean up completed. Task & Agent restored to initial states.")
    print(">>> REGRESSION TEST PASSED SUCCESSFULLY <<<")

if __name__ == "__main__":
    run_regression_test()
