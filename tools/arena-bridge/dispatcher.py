import yaml
from pathlib import Path
try:
    from .config import REPO_ROOT
except (ImportError, ValueError):
    from config import REPO_ROOT

class TaskDispatcher:
    def __init__(self):
        self.repo_root = REPO_ROOT
        self.lego_registry_path = REPO_ROOT / ".arena/registry/lego.yaml"
        self.sublego_registry_path = REPO_ROOT / ".arena/registry/sublego.yaml"

    def load_sublego(self, sublego_id: str) -> dict:
        if not self.sublego_registry_path.exists():
            return None
        with open(self.sublego_registry_path, "r") as f:
            data = yaml.safe_load(f)
            for item in data.get("sublegos", []):
                if item.get("id") == sublego_id:
                    return item
        return None

    def validate_agent_task(self, agent_id: str, sublego_id: str) -> bool:
        sublego = self.load_sublego(sublego_id)
        if not sublego:
            return False
        return sublego.get("owner") == agent_id
