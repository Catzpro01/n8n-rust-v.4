import uuid
import datetime
import time
from tools.orchestration.control_plane import ControlPlaneClient

def run_simulation():
    client = ControlPlaneClient()

    print("=== STARTING ISOLATED AGENT CRASH & OCC FENCING SIMULATION ===")

    # Step 1: Query specialization
    st, specs = client._request("specializations?limit=1")
    spec_id = specs[0]["id"]

    # Step 2: Register Agent A and Agent B
    agent_a_key = f"test-sim-agent-a-{uuid.uuid4().hex[:6]}"
    agent_b_key = f"test-sim-agent-b-{uuid.uuid4().hex[:6]}"

    st, agent_a = client.register_agent(agent_a_key, spec_id)
    agent_a_id = agent_a["id"] if isinstance(agent_a, dict) else agent_a[0]["id"]

    st, agent_b = client.register_agent(agent_b_key, spec_id)
    agent_b_id = agent_b["id"] if isinstance(agent_b, dict) else agent_b[0]["id"]

    print(f"1. Registered Agent A ({agent_a_key}) & Agent B ({agent_b_key})")

    # Step 3: Create Task
    task_key = f"test-sim/task-{uuid.uuid4().hex[:6]}"
    st, task = client._request("tasks", data={
        "task_key": task_key,
        "title": "Crash & Fencing Simulation Task",
        "specialization_id": spec_id,
        "milestone": "M1",
        "status": "QUEUED",
        "branch_name": "runtime-kernel/m1-test-sim"
    }, method="POST")
    task_id = task["id"] if isinstance(task, dict) else task[0]["id"]
    print(f"2. Created QUEUED Task {task_key} (ID: {task_id})")

    try:
        # Step 4: Agent A claims task
        st, claim_a = client.rpc("claim_task", {"p_task_id": task_id, "p_agent_id": agent_a_id, "p_expected_version": 0})
        print(f"3. Agent A claimed task: success={claim_a.get('success')} version={claim_a.get('version')}")
        current_version = claim_a.get("version", 1)

        # Step 5: Agent A starts task
        st, start_a = client.rpc("start_task", {"p_task_id": task_id, "p_agent_id": agent_a_id, "p_expected_version": current_version})
        print(f"4. Agent A starts work: success={start_a.get('success')} status={start_a.get('status')} version={start_a.get('version')}")
        current_version = start_a.get("version", current_version)

        # Step 6: Simulate Agent A crash
        print("5. Simulating Agent A crash (heartbeat timeout & lease expiration)...")
        past_time = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=15)).isoformat()
        client._request(f"agents?id=eq.{agent_a_id}", data={"last_heartbeat": past_time}, method="PATCH")

        # Step 7: Trigger reap_expired_leases
        st, reap = client.rpc("reap_expired_leases", {})
        print(f"6. reap_expired_leases called: {reap}")

        # Step 8: Verify Agent A status
        st, a_state = client._request(f"agents?id=eq.{agent_a_id}")
        print(f"7. Agent A status post-reap: {a_state[0]['status']}")

        # Step 9: Agent B attempts takeover / reclaim
        print("8. Agent B taking over task...")
        st, task_cur = client._request(f"tasks?id=eq.{task_id}")
        takeover_ver = task_cur[0]["version"]
        print(f"   Current task version before takeover: {takeover_ver}")

        # Atomically update task to Agent B with OCC version increment
        st, takeover_patch = client._request(
            f"tasks?id=eq.{task_id}&version=eq.{takeover_ver}",
            data={
                "status": "WORKING",
                "assigned_agent_id": agent_b_id,
                "version": takeover_ver + 1
            },
            method="PATCH"
        )
        print(f"   Agent B takeover result (OCC version {takeover_ver} -> {takeover_ver+1}): HTTP {st}")

        # Step 10: Zombie Agent A attempts mutation
        print("9. Zombie Agent A attempts submit_commit with old version & ownership...")
        st_zombie, res_zombie = client.rpc("submit_commit", {
            "p_task_id": task_id,
            "p_agent_id": agent_a_id,
            "p_commit_sha": "deadbeef123456",
            "p_expected_version": current_version
        })
        print(f"   Zombie Agent A call result: HTTP {st_zombie}, response: {res_zombie}")

        if res_zombie.get("error") in ["NOT_TASK_OWNER", "VERSION_CONFLICT", "INVALID_STATE"]:
            print(">>> PASS: FENCING & OCC BLOCKED ZOMBIE AGENT A! <<<")
        else:
            print(">>> FAIL: Zombie agent was not blocked! <<<")

    finally:
        # Step 11: Cleanup test artifacts
        client._request(f"tasks?id=eq.{task_id}", method="DELETE")
        client._request(f"agents?id=eq.{agent_a_id}", method="DELETE")
        client._request(f"agents?id=eq.{agent_b_id}", method="DELETE")
        print("=== SIMULATION COMPLETED & CLEANED UP ===")

if __name__ == "__main__":
    run_simulation()
