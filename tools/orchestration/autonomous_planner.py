"""
Autonomous Milestone & Task Planner.
Transforms a project goal and repository profile into a structured Milestone Plan and Task DAG.
Supports milestone strategies:
- MODULAR (Libraries)
- END_TO_END (Web applications)
- PIPELINE (Compilers / Data pipelines)
- MIGRATION (Porting / Refactoring projects)
- RESEARCH_HEAVY (Exploratory / Experimental)
- PLATFORM (Infrastructure platforms)
"""

from typing import Dict, Any, List, Optional

class AutonomousPlanner:
    def __init__(self, project_goal: str, profile: Dict[str, Any]):
        self.goal = project_goal
        self.profile = profile
        self.strategy = profile.get("planning", {}).get("strategy", "modular").upper()

    def generate_plan(self) -> Dict[str, Any]:
        """Generates milestones and task DAG based on strategy and detected profile."""
        lang = self.profile.get("project", {}).get("language", "generic")
        
        milestones = [
            {
                "id": "M1",
                "name": "Core Architecture & Foundation",
                "strategy": self.strategy,
                "tasks": [
                    {
                        "task_key": f"{lang}-core/m1-foundation",
                        "title": "Establish Base Module & Domain Primitives",
                        "weight": 2.0,
                        "dependencies": [],
                        "allowed_files": [f"src/lib.{self._ext(lang)}", f"src/core.{self._ext(lang)}"]
                    },
                    {
                        "task_key": f"{lang}-core/m1-error-handling",
                        "title": "Structured Error Definitions & Invariants",
                        "weight": 1.0,
                        "dependencies": [f"{lang}-core/m1-foundation"],
                        "allowed_files": [f"src/error.{self._ext(lang)}"]
                    }
                ]
            },
            {
                "id": "M2",
                "name": "Core Engine & Execution Pipeline",
                "strategy": self.strategy,
                "tasks": [
                    {
                        "task_key": f"{lang}-engine/m2-pipeline",
                        "title": "Core Processing Pipeline Loop",
                        "weight": 2.5,
                        "dependencies": [f"{lang}-core/m1-foundation"],
                        "allowed_files": [f"src/pipeline.{self._ext(lang)}"]
                    }
                ]
            },
            {
                "id": "M3",
                "name": "Testing, Conformance & Security Sandbox",
                "strategy": self.strategy,
                "tasks": [
                    {
                        "task_key": f"{lang}-security/m3-sandbox",
                        "title": "Resource Governor & Execution Containment",
                        "weight": 2.0,
                        "dependencies": [f"{lang}-engine/m2-pipeline"],
                        "allowed_files": [f"src/security.{self._ext(lang)}"]
                    }
                ]
            }
        ]

        total_tasks = sum(len(m["tasks"]) for m in milestones)
        total_weight = sum(sum(t["weight"] for t in m["tasks"]) for m in milestones)

        return {
            "project_name": self.profile.get("project", {}).get("name", "arena-project"),
            "goal": self.goal,
            "milestone_strategy": self.strategy,
            "total_milestones": len(milestones),
            "total_tasks": total_tasks,
            "total_weight": total_weight,
            "milestones": milestones,
            "risks": [
                {"risk": "Resource Exhaustion", "severity": "MEDIUM", "mitigation": "Enforce ResourceGovernor limits"},
                {"risk": "Concurrency Races", "severity": "HIGH", "mitigation": "Atomic OCC RPC version checking"}
            ]
        }

    def _ext(self, lang: str) -> str:
        mapping = {"rust": "rs", "python": "py", "typescript": "ts", "javascript": "js", "go": "go"}
        return mapping.get(lang.lower(), "rs")
