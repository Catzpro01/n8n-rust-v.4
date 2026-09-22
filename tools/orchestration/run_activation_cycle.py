from tools.orchestration.continuous_worker_engine import ContinuousWorkerEngine
from tools.orchestration.control_plane import ControlPlaneClient

def activate():
    client = ControlPlaneClient()
    engine = ContinuousWorkerEngine(client=client)

    st, agents = client._request("agents?select=*")
    for a in agents:
        aid = a["id"]
        # Update heartbeat to fresh
        client._request(f"agents?id=eq.{aid}", data={"last_heartbeat": "NOW()"}, method="PATCH")

    # Filter available agents
    available_agents = [a for a in agents if a["status"] == "AVAILABLE"]
    print(f"Triggering atomic activation cycle for {len(available_agents)} available workers...")

    for a in available_agents:
        aid = a["id"]
        akey = a["agent_key"]
        res = engine.advance_worker_cycle(aid)
        print(f"Activation Result for {akey}: {res}")

if __name__ == "__main__":
    activate()
