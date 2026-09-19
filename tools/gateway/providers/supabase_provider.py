"""
Supabase Capability Provider for Arena Manager Gateway.
Enables management of tasks, agents, claims, locks, events, and Control Plane state
without exposing service keys, JWTs, or database credentials.
Supports controlled schema migration management:
    REPOSITORY MIGRATION FILE -> VALIDATION -> CAPABILITY GATEWAY -> SUPABASE -> MIGRATION RESULT
"""

import os
import re
import json
import sqlite3
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer

FORBIDDEN_SQL_PATTERNS = [
    r"\bDROP\s+DATABASE\b",
    r"\bALTER\s+SYSTEM\b",
    r"\bSHUTDOWN\b",
    r"\bCOPY\s+.*\bFROM\s+PROGRAM\b",
    r"\bSUPERUSER\b",
]

class SupabaseProvider:
    def __init__(
        self,
        vault: SecretVault,
        sanitizer: Sanitizer,
        repo_root: Optional[Path] = None,
        local_db_path: Optional[Path] = None
    ):
        self.vault = vault
        self.sanitizer = sanitizer
        self.repo_root = repo_root or Path(__file__).resolve().parents[3]
        self.local_db_path = local_db_path or (self.repo_root / ".arena" / "state" / "control_plane.db")
        self.local_db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_local_db()

    # -------------------------------------------------------------------------
    # Credential & Mode Resolution
    # -------------------------------------------------------------------------
    def _get_creds(self) -> Tuple[Optional[str], Optional[str]]:
        url = self.vault.get("SUPABASE_URL")
        key = self.vault.get("SUPABASE_SERVICE_ROLE_KEY") or self.vault.get("SUPABASE_KEY")
        if url and key:
            return url.rstrip("/"), key
        return None, None

    def _has_remote_creds(self) -> bool:
        url, key = self._get_creds()
        return bool(url and key)

    def _request(self, endpoint: str, method: str = "GET", data: Optional[Dict[str, Any]] = None, is_rpc: bool = False) -> Any:
        url, key = self._get_creds()
        if not url or not key:
            raise RuntimeError("Supabase credentials not available in vault")

        prefix = "rpc" if is_rpc else "rest/v1"
        full_url = f"{url}/{prefix}/{endpoint.lstrip('/')}"

        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        payload = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(full_url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {"status": resp.status}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8") if e.fp else ""
            raise RuntimeError(f"Supabase Error ({e.code}): {self.sanitizer.sanitize_string(err_body)}")
        except Exception as ex:
            raise RuntimeError(f"Supabase Network Error: {self.sanitizer.sanitize_string(str(ex))}")

    # -------------------------------------------------------------------------
    # Local Embedded Control-Plane SQLite Engine
    # -------------------------------------------------------------------------
    def _init_local_db(self):
        with sqlite3.connect(self.local_db_path) as conn:
            c = conn.cursor()
            # Schema migrations tracking table
            c.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL,
                checksum TEXT NOT NULL,
                rollback_sql TEXT
            );
            """)

            # Core Control-Plane tables
            c.execute("""
            CREATE TABLE IF NOT EXISTS milestones (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                weight REAL DEFAULT 1.0
            );
            """)

            c.execute("""
            CREATE TABLE IF NOT EXISTS specializations (
                id TEXT PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                milestone TEXT NOT NULL
            );
            """)

            c.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                agent_key TEXT UNIQUE NOT NULL,
                specialization_id TEXT,
                status TEXT NOT NULL DEFAULT 'AVAILABLE',
                current_task_id TEXT,
                last_heartbeat TEXT,
                capabilities TEXT DEFAULT '{}'
            );
            """)

            c.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                task_key TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                specialization_id TEXT,
                milestone TEXT,
                status TEXT NOT NULL DEFAULT 'QUEUED',
                progress_weight REAL DEFAULT 1.0,
                validation_level TEXT DEFAULT 'LEVEL_1',
                version INTEGER DEFAULT 1,
                assigned_agent_id TEXT,
                base_commit TEXT,
                current_commit_sha TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """)

            c.execute("""
            CREATE TABLE IF NOT EXISTS locks (
                id TEXT PRIMARY KEY,
                resource_id TEXT UNIQUE NOT NULL,
                resource_type TEXT NOT NULL,
                owner_agent TEXT NOT NULL,
                task_id TEXT,
                acquired_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            """)

            c.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload TEXT DEFAULT '{}',
                source TEXT DEFAULT 'arena_manager',
                created_at TEXT NOT NULL
            );
            """)

            # Seed default canonical specializations if empty
            c.execute("SELECT COUNT(*) FROM specializations")
            if c.fetchone()[0] == 0:
                defaults = [
                    ("spec-01", "workflow-core", "Workflow Core Engine", "M1"),
                    ("spec-02", "node-model", "Node Model & Credentials", "M1"),
                    ("spec-03", "connection-engine", "Connection & Webhook Engine", "M2"),
                    ("spec-04", "execution-plane", "Execution Data & Sandboxing", "M3"),
                    ("spec-05", "validation-engine", "Validation & Persistence", "M4"),
                ]
                c.executemany("INSERT OR IGNORE INTO specializations (id, slug, name, milestone) VALUES (?, ?, ?, ?)", defaults)

            # Seed default agents if empty
            c.execute("SELECT COUNT(*) FROM agents")
            if c.fetchone()[0] == 0:
                agent_defaults = [
                    ("agent-01", "agent-01", "spec-01", "AVAILABLE", None),
                    ("agent-02", "agent-02", "spec-02", "AVAILABLE", None),
                    ("agent-03", "agent-03", "spec-03", "AVAILABLE", None),
                    ("agent-04", "agent-04", "spec-04", "AVAILABLE", None),
                    ("agent-05", "agent-05", "spec-05", "AVAILABLE", None),
                ]
                now_str = datetime.now(timezone.utc).isoformat()
                c.executemany("INSERT OR IGNORE INTO agents (id, agent_key, specialization_id, status, last_heartbeat) VALUES (?, ?, ?, ?, ?)",
                              [(a[0], a[1], a[2], a[3], now_str) for a in agent_defaults])

            conn.commit()

    def _adapt_sql_for_sqlite(self, sql: str) -> str:
        """Adapts PostgreSQL migration DDL for execution in local SQLite store."""
        lines = []
        for line in sql.splitlines():
            trimmed = line.strip()
            if trimmed.startswith("--") or not trimmed:
                continue
            # Strip PostgreSQL permissions / session commands
            if any(trimmed.upper().startswith(x) for x in ["REVOKE", "GRANT", "SET ", "COMMENT ON", "CREATE EXTENSION"]):
                continue
            lines.append(line)
        text = "\n".join(lines)
        # Strip schema qualifier "public."
        text = re.sub(r"\bpublic\.", "", text)
        # Type substitutions
        text = re.sub(r"\bTIMESTAMPTZ\b", "TEXT", text, flags=re.I)
        text = re.sub(r"\bTIMESTAMP WITH TIME ZONE\b", "TEXT", text, flags=re.I)
        text = re.sub(r"\bUUID\b", "TEXT", text, flags=re.I)
        text = re.sub(r"\bJSONB\b", "TEXT", text, flags=re.I)
        text = re.sub(r"\bNOW\(\)", "CURRENT_TIMESTAMP", text, flags=re.I)
        return text

    # -------------------------------------------------------------------------
    # Migration Management (Phase 2 & Phase 3)
    # Model: REPOSITORY MIGRATION FILE -> VALIDATION -> CAPABILITY GATEWAY -> SUPABASE -> MIGRATION RESULT
    # -------------------------------------------------------------------------
    def _get_migrations_dir(self) -> Path:
        p = self.repo_root / "supabase" / "migrations"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _parse_migration_content(self, content: str) -> Tuple[str, Optional[str]]:
        """Extracts UP and DOWN SQL segments from migration file."""
        up_marker = re.search(r"--\s*migrate:up|--\s*up:|--\s*\[up\]", content, re.I)
        down_marker = re.search(r"--\s*migrate:down|--\s*down:|--\s*\[down\]|--\s*rollback", content, re.I)

        if up_marker and down_marker:
            if up_marker.start() < down_marker.start():
                sql_up = content[up_marker.end():down_marker.start()].strip()
                sql_down = content[down_marker.end():].strip()
            else:
                sql_down = content[down_marker.end():up_marker.start()].strip()
                sql_up = content[up_marker.end():].strip()
            return sql_up, (sql_down if sql_down else None)
        elif up_marker:
            sql_up = content[up_marker.end():].strip()
            return sql_up, None
        else:
            return content.strip(), None

    def _validate_migration_file(self, file_path: Path, content: str) -> Tuple[bool, str]:
        """Validates filename format and checks for forbidden destructive SQL patterns."""
        if not file_path.exists():
            return False, f"Migration file does not exist: {file_path.name}"

        # Ensure inside migrations dir (no directory traversal)
        try:
            file_path.resolve().relative_to(self._get_migrations_dir().resolve())
        except ValueError:
            return False, "Directory traversal detected; file is outside supabase/migrations"

        # Check filename pattern
        if not re.match(r"^\d{14}_[a-zA-Z0-9_-]+\.sql$", file_path.name):
            # Allow fallback naming like standard 20260919000000_name.sql
            if not (file_path.name.endswith(".sql") and file_path.name[:14].isdigit()):
                return False, f"Invalid migration filename format: '{file_path.name}'. Expected YYYYMMDDHHMMSS_<name>.sql"

        if not content.strip():
            return False, "Migration file content is empty"

        for pattern in FORBIDDEN_SQL_PATTERNS:
            if re.search(pattern, content, re.I):
                return False, f"Migration violates security policy: matches forbidden pattern '{pattern}'"

        return True, "VALID"

    def create_migration(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates a new migration file in supabase/migrations/ following repository conventions.
        params:
            - name: str (e.g., 'add_worker_leases')
            - sql_up: str (SQL statements to apply)
            - sql_down: Optional[str] (SQL statements to rollback)
        """
        name = params.get("name")
        sql_up = params.get("sql_up")
        sql_down = params.get("sql_down")

        if not name or not sql_up:
            raise ValueError("Parameters 'name' and 'sql_up' are required to create migration")

        clean_name = re.sub(r"[^a-zA-Z0-9_]", "_", name.strip().lower())
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        filename = f"{timestamp}_{clean_name}.sql"
        file_path = self._get_migrations_dir() / filename

        body_parts = ["-- migrate:up", sql_up.strip(), ""]
        if sql_down and sql_down.strip():
            body_parts.extend(["-- migrate:down", sql_down.strip(), ""])

        full_content = "\n".join(body_parts)
        file_path.write_text(full_content, encoding="utf-8")

        return {
            "status": "SUCCESS",
            "version": timestamp,
            "name": clean_name,
            "file_name": filename,
            "file_path": f"supabase/migrations/{filename}",
            "reversible": bool(sql_down and sql_down.strip())
        }

    def read_migration(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Reads and parses an existing migration file from supabase/migrations/.
        params:
            - version: Optional[str] (14-digit timestamp)
            - file_name: Optional[str] (filename)
        """
        version = params.get("version")
        file_name = params.get("file_name")

        target_file = None
        mig_dir = self._get_migrations_dir()
        if file_name:
            target_file = mig_dir / file_name
        elif version:
            matches = list(mig_dir.glob(f"{version}_*.sql"))
            if matches:
                target_file = matches[0]

        if not target_file or not target_file.exists():
            raise FileNotFoundError(f"Migration file not found for version='{version}' or file_name='{file_name}'")

        content = target_file.read_text(encoding="utf-8")
        sql_up, sql_down = self._parse_migration_content(content)
        ver = target_file.name[:14]
        mig_name = target_file.name[15:-4] if len(target_file.name) > 19 else target_file.stem

        return {
            "status": "SUCCESS",
            "version": ver,
            "name": mig_name,
            "file_name": target_file.name,
            "sql_up": sql_up,
            "sql_down": sql_down,
            "reversible": bool(sql_down),
            "checksum": hashlib.sha256(content.encode("utf-8")).hexdigest()
        }

    def migration_status(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Scans repository migration files and compares against applied migrations in the database.
        """
        mig_dir = self._get_migrations_dir()
        files = sorted(mig_dir.glob("*.sql"))

        applied_map = {}
        if self._has_remote_creds():
            try:
                rows = self._request("schema_migrations?select=*")
                if isinstance(rows, list):
                    for r in rows:
                        applied_map[str(r.get("version"))] = r
            except Exception:
                # If schema_migrations table doesn't exist remotely yet, treated as 0 applied
                pass
        else:
            with sqlite3.connect(self.local_db_path) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                for row in c.execute("SELECT version, name, applied_at, checksum, rollback_sql FROM schema_migrations"):
                    applied_map[row["version"]] = dict(row)

        migrations = []
        applied_count = 0
        pending_count = 0

        for f in files:
            ver = f.name[:14]
            name = f.name[15:-4] if len(f.name) > 19 else f.stem
            content = f.read_text(encoding="utf-8")
            _, sql_down = self._parse_migration_content(content)
            checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()

            is_applied = ver in applied_map
            applied_info = applied_map.get(ver, {})
            applied_at = applied_info.get("applied_at")

            if is_applied:
                applied_count += 1
                status = "APPLIED"
            else:
                pending_count += 1
                status = "PENDING"

            migrations.append({
                "version": ver,
                "name": name,
                "file_name": f.name,
                "status": status,
                "applied_at": applied_at,
                "reversible": bool(sql_down),
                "checksum": checksum
            })

        return {
            "status": "SUCCESS",
            "total_migrations": len(migrations),
            "applied_count": applied_count,
            "pending_count": pending_count,
            "migrations": migrations
        }

    def apply_migration(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Applies a validated repository migration file to Supabase / local control plane.
        params:
            - version: Optional[str]
            - file_name: Optional[str]
        """
        mig_info = self.read_migration(params)
        version = mig_info["version"]
        name = mig_info["name"]
        file_name = mig_info["file_name"]
        sql_up = mig_info["sql_up"]
        sql_down = mig_info["sql_down"]
        checksum = mig_info["checksum"]

        # Validate file
        target_file = self._get_migrations_dir() / file_name
        is_valid, reason = self._validate_migration_file(target_file, target_file.read_text(encoding="utf-8"))
        if not is_valid:
            return {"status": "FAILED", "error": f"MIGRATION_VALIDATION_ERROR: {reason}", "version": version}

        # Check if already applied
        current_status = self.migration_status()
        for m in current_status.get("migrations", []):
            if m["version"] == version and m["status"] == "APPLIED":
                return {
                    "status": "MIGRATION_ALREADY_APPLIED",
                    "version": version,
                    "name": name,
                    "applied_at": m.get("applied_at"),
                    "message": f"Migration '{version}' has already been applied"
                }

        now_str = datetime.now(timezone.utc).isoformat()

        if self._has_remote_creds():
            try:
                # Execute migration on Supabase via RPC or PostgREST schema runner
                res = self._request("apply_schema_migration", method="POST", data={
                    "p_version": version,
                    "p_name": name,
                    "p_sql_up": sql_up,
                    "p_sql_down": sql_down or "",
                    "p_checksum": checksum
                }, is_rpc=True)
                return {
                    "status": "MIGRATION_APPLIED",
                    "version": version,
                    "name": name,
                    "reversible": bool(sql_down),
                    "remote": True
                }
            except Exception as e:
                err_msg = self.sanitizer.sanitize_string(str(e))
                return {
                    "status": "FAILED",
                    "error": f"REMOTE_MIGRATION_FAILED: {err_msg}",
                    "version": version
                }
        else:
            # Local embedded SQLite execution
            try:
                adapted_sql = self._adapt_sql_for_sqlite(sql_up)
                with sqlite3.connect(self.local_db_path) as conn:
                    conn.executescript(adapted_sql)
                    conn.execute(
                        "INSERT INTO schema_migrations (version, name, applied_at, checksum, rollback_sql) VALUES (?, ?, ?, ?, ?)",
                        (version, name, now_str, checksum, sql_down)
                    )
                    conn.commit()

                return {
                    "status": "MIGRATION_APPLIED",
                    "version": version,
                    "name": name,
                    "reversible": bool(sql_down),
                    "applied_at": now_str
                }
            except Exception as ex:
                err_msg = self.sanitizer.sanitize_string(str(ex))
                return {
                    "status": "FAILED",
                    "error": f"LOCAL_MIGRATION_FAILED: {err_msg}",
                    "version": version
                }

    def schema_upgrade(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Executes all pending repository migrations in sequential order.
        """
        stat = self.migration_status()
        pending = [m for m in stat.get("migrations", []) if m["status"] == "PENDING"]

        applied_versions = []
        for m in pending:
            res = self.apply_migration({"version": m["version"]})
            if res.get("status") != "MIGRATION_APPLIED":
                return {
                    "status": "FAILED",
                    "error": f"Failed applying migration {m['version']}: {res.get('error')}",
                    "applied_versions": applied_versions,
                    "pending_remaining": len(pending) - len(applied_versions)
                }
            applied_versions.append(m["version"])

        return {
            "status": "SUCCESS",
            "applied_versions": applied_versions,
            "total_applied": len(applied_versions),
            "pending_remaining": 0
        }

    def rollback_migration(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Rolls back an applied migration if a valid rollback procedure is defined.
        params:
            - version: str (14-digit timestamp)
        """
        version = params.get("version")
        if not version:
            raise ValueError("Parameter 'version' is required for rollback")

        if self._has_remote_creds():
            try:
                res = self._request("rollback_schema_migration", method="POST", data={
                    "p_version": version
                }, is_rpc=True)
                return {
                    "status": "MIGRATION_ROLLED_BACK",
                    "version": version,
                    "remote": True
                }
            except Exception as e:
                err_msg = self.sanitizer.sanitize_string(str(e))
                return {"status": "FAILED", "error": f"REMOTE_ROLLBACK_FAILED: {err_msg}", "version": version}
        else:
            with sqlite3.connect(self.local_db_path) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                row = c.execute("SELECT version, name, rollback_sql FROM schema_migrations WHERE version = ?", (version,)).fetchone()
                if not row:
                    return {"status": "FAILED", "error": f"Migration '{version}' has not been applied", "version": version}

                rollback_sql = row["rollback_sql"]
                if not rollback_sql or not rollback_sql.strip():
                    return {
                        "status": "FAILED",
                        "error": f"Migration '{version}' does not define a rollback procedure (irreversible)",
                        "version": version
                    }

                try:
                    adapted_down = self._adapt_sql_for_sqlite(rollback_sql)
                    conn.executescript(adapted_down)
                    conn.execute("DELETE FROM schema_migrations WHERE version = ?", (version,))
                    conn.commit()
                    return {
                        "status": "MIGRATION_ROLLED_BACK",
                        "version": version,
                        "name": row["name"]
                    }
                except Exception as ex:
                    err_msg = self.sanitizer.sanitize_string(str(ex))
                    return {"status": "FAILED", "error": f"LOCAL_ROLLBACK_FAILED: {err_msg}", "version": version}

    # -------------------------------------------------------------------------
    # Control Plane Operations (Tasks, Agents, Locks, Events)
    # -------------------------------------------------------------------------
    def read_table(self, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        table = params.get("table")
        query_str = params.get("query", "select=*")
        if not table:
            raise ValueError("Parameter 'table' is required")

        if self._has_remote_creds():
            res = self._request(f"{table}?{query_str}")
            return self.sanitizer.sanitize(res) if isinstance(res, list) else [res]
        else:
            with sqlite3.connect(self.local_db_path) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                clean_tbl = re.sub(r"[^a-zA-Z0-9_]", "", table)
                rows = c.execute(f"SELECT * FROM {clean_tbl} LIMIT 100").fetchall()
                result = [dict(r) for r in rows]
                return self.sanitizer.sanitize(result)

    def write_table(self, params: Dict[str, Any]) -> Any:
        table = params.get("table")
        data = params.get("data")
        method = params.get("method", "POST").upper()
        filter_query = params.get("filter", "")
        if not table or data is None:
            raise ValueError("Parameters 'table' and 'data' are required")

        if self._has_remote_creds():
            endpoint = f"{table}?{filter_query}" if filter_query else table
            res = self._request(endpoint, method=method, data=data)
            return self.sanitizer.sanitize(res)
        else:
            with sqlite3.connect(self.local_db_path) as conn:
                c = conn.cursor()
                clean_tbl = re.sub(r"[^a-zA-Z0-9_]", "", table)
                keys = list(data.keys())
                vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in data.values()]
                placeholders = ", ".join(["?"] * len(keys))
                col_names = ", ".join(keys)

                if method == "POST":
                    c.execute(f"INSERT OR REPLACE INTO {clean_tbl} ({col_names}) VALUES ({placeholders})", vals)
                conn.commit()
                return {"status": "SUCCESS", "written": True, "table": clean_tbl}

    def rpc(self, params: Dict[str, Any]) -> Any:
        func_name = params.get("function") or params.get("name")
        args = params.get("args") or params.get("arguments") or {}
        if not func_name:
            raise ValueError("Parameter 'function' is required")

        if self._has_remote_creds():
            res = self._request(func_name, method="POST", data=args, is_rpc=True)
            return self.sanitizer.sanitize(res)
        else:
            # Handle canonical RPCs in local SQLite mode
            with sqlite3.connect(self.local_db_path) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                now_str = datetime.now(timezone.utc).isoformat()

                if func_name == "claim_task":
                    task_id = args.get("p_task_id")
                    agent_id = args.get("p_agent_id")
                    c.execute("UPDATE tasks SET status = 'CLAIMED', assigned_agent_id = ?, updated_at = ? WHERE id = ?",
                              (agent_id, now_str, task_id))
                    conn.commit()
                    return {"claimed": True, "task_id": task_id, "agent_id": agent_id}

                elif func_name == "start_task":
                    task_id = args.get("p_task_id")
                    c.execute("UPDATE tasks SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?", (now_str, task_id))
                    conn.commit()
                    return {"started": True, "task_id": task_id}

                elif func_name == "acquire_file_lock":
                    res_id = args.get("p_resource")
                    agent_id = args.get("p_agent_id")
                    task_id = args.get("p_task_id")
                    lock_id = f"lock-{hashlib.sha256(res_id.encode()).hexdigest()[:12]}"
                    c.execute("INSERT OR REPLACE INTO locks (id, resource_id, resource_type, owner_agent, task_id, acquired_at, expires_at) VALUES (?, ?, 'file', ?, ?, ?, ?)",
                              (lock_id, res_id, agent_id, task_id, now_str, now_str))
                    conn.commit()
                    return {"acquired": True, "resource": res_id}

                elif func_name == "release_file_lock":
                    res_id = args.get("p_resource")
                    c.execute("DELETE FROM locks WHERE resource_id = ?", (res_id,))
                    conn.commit()
                    return {"released": True, "resource": res_id}

                elif func_name == "agent_heartbeat":
                    agent_id = args.get("p_agent_id")
                    c.execute("UPDATE agents SET last_heartbeat = ? WHERE id = ? OR agent_key = ?", (now_str, agent_id, agent_id))
                    conn.commit()
                    return {"ok": True, "agent_id": agent_id, "timestamp": now_str}

                elif func_name == "get_project_progress":
                    c.execute("SELECT status, progress_weight FROM tasks")
                    rows = c.fetchall()
                    total = sum(float(r["progress_weight"] or 1.0) for r in rows) or 1.0
                    done = sum(float(r["progress_weight"] or 1.0) for r in rows if r["status"] == "DONE")
                    return {"total_weight": total, "completed_weight": done, "percent": round((done/total)*100, 2)}

                return {"status": "SUCCESS", "rpc": func_name, "handled_locally": True}

    def inspect_tasks(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        params = params or {}
        status_filter = params.get("status")

        if self._has_remote_creds():
            query = "select=id,task_key,title,status,priority,progress_weight,version,assigned_agent_id"
            if status_filter:
                query += f"&status=eq.{status_filter}"
            tasks = self._request(f"tasks?{query}")
        else:
            with sqlite3.connect(self.local_db_path) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                if status_filter:
                    rows = c.execute("SELECT * FROM tasks WHERE status = ?", (status_filter,)).fetchall()
                else:
                    rows = c.execute("SELECT * FROM tasks").fetchall()
                tasks = [dict(r) for r in rows]

        by_status = {}
        for t in tasks:
            st = t.get("status", "UNKNOWN")
            by_status[st] = by_status.get(st, 0) + 1

        return {
            "total": len(tasks),
            "summary_by_status": by_status,
            "tasks": self.sanitizer.sanitize(tasks)
        }

    def inspect_agents(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if self._has_remote_creds():
            agents = self._request("agents?select=id,agent_key,specialization_id,status,current_task_id,last_heartbeat")
        else:
            with sqlite3.connect(self.local_db_path) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                rows = c.execute("SELECT * FROM agents").fetchall()
                agents = [dict(r) for r in rows]

        available = [a for a in agents if a.get("status") == "AVAILABLE"]
        working = [a for a in agents if a.get("status") != "AVAILABLE"]

        return {
            "total_agents": len(agents),
            "available_count": len(available),
            "working_count": len(working),
            "agents": self.sanitizer.sanitize(agents)
        }

    def inspect_locks(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if self._has_remote_creds():
            locks = self._request("locks?select=*")
        else:
            with sqlite3.connect(self.local_db_path) as conn:
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                rows = c.execute("SELECT * FROM locks").fetchall()
                locks = [dict(r) for r in rows]

        return {
            "total_active_locks": len(locks),
            "locks": self.sanitizer.sanitize(locks)
        }

    def create_task(self, params: Dict[str, Any]) -> Dict[str, Any]:
        task_data = params.get("task") or params
        required = ["task_key", "title", "specialization_id", "milestone"]
        for r in required:
            if r not in task_data:
                raise ValueError(f"Field '{r}' is required to create task")

        if self._has_remote_creds():
            res = self._request("tasks", method="POST", data=task_data)
            return {"status": "SUCCESS", "created": True, "task": self.sanitizer.sanitize(res)}
        else:
            now_str = datetime.now(timezone.utc).isoformat()
            task_id = task_data.get("id") or f"task-{hashlib.sha256(task_data['task_key'].encode()).hexdigest()[:12]}"
            with sqlite3.connect(self.local_db_path) as conn:
                c = conn.cursor()
                c.execute("""
                INSERT OR REPLACE INTO tasks (
                    id, task_key, title, description, specialization_id, milestone,
                    status, progress_weight, validation_level, version, assigned_agent_id,
                    base_commit, current_commit_sha, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    task_id,
                    task_data["task_key"],
                    task_data["title"],
                    task_data.get("description", ""),
                    task_data["specialization_id"],
                    task_data["milestone"],
                    task_data.get("status", "QUEUED"),
                    float(task_data.get("progress_weight", 1.0)),
                    task_data.get("validation_level", "LEVEL_1"),
                    int(task_data.get("version", 1)),
                    task_data.get("assigned_agent_id"),
                    task_data.get("base_commit"),
                    task_data.get("current_commit_sha"),
                    now_str,
                    now_str
                ))
                conn.commit()

            return {
                "status": "SUCCESS",
                "created": True,
                "task": {
                    "id": task_id,
                    "task_key": task_data["task_key"],
                    "title": task_data["title"],
                    "status": task_data.get("status", "QUEUED")
                }
            }

    def update_task_state(self, params: Dict[str, Any]) -> Dict[str, Any]:
        task_id = params.get("task_id")
        task_key = params.get("task_key")
        new_status = params.get("status")

        if not (task_id or task_key) or not new_status:
            raise ValueError("Parameters ('task_id' or 'task_key') and 'status' are required")

        if self._has_remote_creds():
            filter_param = f"id=eq.{task_id}" if task_id else f"task_key=eq.{task_key}"
            payload = {"status": new_status}
            if "assigned_agent_id" in params:
                payload["assigned_agent_id"] = params["assigned_agent_id"]
            res = self._request(f"tasks?{filter_param}", method="PATCH", data=payload)
            return {"status": "SUCCESS", "updated": True, "result": self.sanitizer.sanitize(res)}
        else:
            now_str = datetime.now(timezone.utc).isoformat()
            with sqlite3.connect(self.local_db_path) as conn:
                c = conn.cursor()
                if "assigned_agent_id" in params:
                    if task_id:
                        c.execute("UPDATE tasks SET status = ?, assigned_agent_id = ?, updated_at = ? WHERE id = ?",
                                  (new_status, params["assigned_agent_id"], now_str, task_id))
                    else:
                        c.execute("UPDATE tasks SET status = ?, assigned_agent_id = ?, updated_at = ? WHERE task_key = ?",
                                  (new_status, params["assigned_agent_id"], now_str, task_key))
                else:
                    if task_id:
                        c.execute("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", (new_status, now_str, task_id))
                    else:
                        c.execute("UPDATE tasks SET status = ?, updated_at = ? WHERE task_key = ?", (new_status, now_str, task_key))
                conn.commit()

            return {"status": "SUCCESS", "updated": True, "new_status": new_status}

    def record_event(self, params: Dict[str, Any]) -> Dict[str, Any]:
        event_type = params.get("event_type")
        payload = params.get("payload") or {}
        if not event_type:
            raise ValueError("Parameter 'event_type' is required")

        if self._has_remote_creds():
            data = {
                "event_type": event_type,
                "payload": payload,
                "source": "arena_manager"
            }
            res = self._request("events", method="POST", data=data)
            return {"status": "SUCCESS", "recorded": True, "event": self.sanitizer.sanitize(res)}
        else:
            event_id = f"evt-{hashlib.sha256(f'{event_type}:{datetime.now().isoformat()}'.encode()).hexdigest()[:12]}"
            now_str = datetime.now(timezone.utc).isoformat()
            with sqlite3.connect(self.local_db_path) as conn:
                c = conn.cursor()
                c.execute(
                    "INSERT INTO events (id, event_type, payload, source, created_at) VALUES (?, ?, ?, 'arena_manager', ?)",
                    (event_id, event_type, json.dumps(payload), now_str)
                )
                conn.commit()

            return {
                "status": "SUCCESS",
                "recorded": True,
                "event": {"id": event_id, "event_type": event_type, "timestamp": now_str}
            }

    def get_project_state(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        tasks_res = self.inspect_tasks()
        agents_res = self.inspect_agents()

        tasks = tasks_res.get("tasks", [])
        agents = agents_res.get("agents", [])

        done = [t for t in tasks if t.get("status") == "DONE"]
        queued = [t for t in tasks if t.get("status") == "QUEUED"]
        active = [t for t in tasks if t.get("status") not in ("DONE", "QUEUED")]

        total_w = sum(float(t.get("progress_weight", 0.0)) for t in tasks) or 1.0
        done_w = sum(float(t.get("progress_weight", 0.0)) for t in done)

        avail_agents = [a for a in agents if a.get("status") == "AVAILABLE"]
        working_agents = [a for a in agents if a.get("status") != "AVAILABLE"]

        return {
            "status": "SUCCESS",
            "total_tasks": len(tasks),
            "done_tasks": len(done),
            "queued_tasks": len(queued),
            "active_tasks": len(active),
            "weighted_progress": f"{done_w:.1f}/{total_w:.1f} ({(done_w/total_w)*100:.1f}%)",
            "available_agents": len(avail_agents),
            "working_agents": len(working_agents)
        }
