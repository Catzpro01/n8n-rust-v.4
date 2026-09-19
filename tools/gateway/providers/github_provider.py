"""
GitHub Capability Provider for Arena Manager Gateway.
Executes repository operations via GitHub REST API and git CLI using vault-injected credentials.
All return values and error messages are strictly sanitized.
"""

import json
import urllib.request
import urllib.error
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional
from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer

class GitHubProvider:
    def __init__(self, vault: SecretVault, sanitizer: Sanitizer, repo_root: Optional[Path] = None):
        self.vault = vault
        self.sanitizer = sanitizer
        self.repo_root = repo_root or Path(__file__).resolve().parents[3]
        self.repo_name = "Catzpro01/n8n-rust-v.4"

    def _get_token(self) -> str:
        token = self.vault.get("GITHUB_TOKEN") or self.vault.get("GITHUB_PAT") or ""
        if not token:
            raise RuntimeError("GitHub authentication credential not available in vault")
        return token

    def _api_request(self, endpoint: str, method: str = "GET", data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        token = self._get_token()
        clean_ep = endpoint.lstrip('/')
        if clean_ep:
            url = f"https://api.github.com/repos/{self.repo_name}/{clean_ep}"
        else:
            url = f"https://api.github.com/repos/{self.repo_name}"
        headers = {
            "Authorization": f"token {token}",
            "User-Agent": "arena-manager-gateway/1.7",
            "Accept": "application/vnd.github.v3+json"
        }
        payload = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {"status": resp.status}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                parsed = json.loads(err_body)
                msg = parsed.get("message", err_body)
            except Exception:
                msg = err_body
            raise RuntimeError(f"GitHub API Error ({e.code}): {self.sanitizer.sanitize_string(msg)}")
        except Exception as ex:
            raise RuntimeError(f"GitHub Network Error: {self.sanitizer.sanitize_string(str(ex))}")

    # Capability implementations
    def read_repo(self, params: Dict[str, Any]) -> Dict[str, Any]:
        data = self._api_request("")
        return {
            "name": data.get("name"),
            "full_name": data.get("full_name"),
            "default_branch": data.get("default_branch"),
            "description": data.get("description"),
            "visibility": data.get("visibility")
        }

    def list_branches(self, params: Dict[str, Any]) -> Dict[str, Any]:
        data = self._api_request("branches?per_page=100")
        branches = [{"name": b["name"], "commit_sha": b["commit"]["sha"]} for b in data if isinstance(b, dict)]
        return {"total": len(branches), "branches": branches}

    def get_branch(self, params: Dict[str, Any]) -> Dict[str, Any]:
        branch = params.get("branch") or params.get("branch_name")
        if not branch:
            raise ValueError("Parameter 'branch' is required")
        data = self._api_request(f"branches/{branch}")
        return {
            "name": data.get("name"),
            "commit_sha": data.get("commit", {}).get("sha"),
            "protected": data.get("protected", False)
        }

    def create_branch(self, params: Dict[str, Any]) -> Dict[str, Any]:
        branch = params.get("branch") or params.get("branch_name")
        from_ref = params.get("from_branch") or params.get("from_ref") or "main"
        if not branch:
            raise ValueError("Parameter 'branch' is required")

        # Get SHA of from_ref
        ref_data = self._api_request(f"git/ref/heads/{from_ref}")
        sha = ref_data.get("object", {}).get("sha")
        if not sha:
            raise RuntimeError(f"Could not resolve base commit for '{from_ref}'")

        # Create ref
        payload = {"ref": f"refs/heads/{branch}", "sha": sha}
        res = self._api_request("git/refs", method="POST", data=payload)
        return {
            "branch": branch,
            "created": True,
            "commit_sha": sha,
            "ref": res.get("ref")
        }

    def delete_branch(self, params: Dict[str, Any]) -> Dict[str, Any]:
        branch = params.get("branch") or params.get("branch_name")
        if not branch:
            raise ValueError("Parameter 'branch' is required")
        # Direct API delete
        res = self._api_request(f"git/refs/heads/{branch}", method="DELETE")
        return {"branch": branch, "deleted": True}

    def read_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        path = params.get("path")
        ref = params.get("ref") or "main"
        if not path:
            raise ValueError("Parameter 'path' is required")
        res = self._api_request(f"contents/{path}?ref={ref}")
        import base64
        content_b64 = res.get("content", "")
        decoded = base64.b64decode(content_b64).decode("utf-8", errors="replace") if content_b64 else ""
        return {
            "path": path,
            "ref": ref,
            "sha": res.get("sha"),
            "size": res.get("size"),
            "content": decoded
        }

    def write_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        path = params.get("path")
        content = params.get("content", "")
        branch = params.get("branch") or "arena-manager"
        message = params.get("message") or f"chore(manager): update {path}"
        if not path:
            raise ValueError("Parameter 'path' is required")

        import base64
        # Check existing file for sha
        sha = None
        try:
            cur = self._api_request(f"contents/{path}?ref={branch}")
            sha = cur.get("sha")
        except Exception:
            pass

        payload = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch
        }
        if sha:
            payload["sha"] = sha

        res = self._api_request(f"contents/{path}", method="PUT", data=payload)
        return {
            "path": path,
            "branch": branch,
            "commit_sha": res.get("commit", {}).get("sha"),
            "written": True
        }

    def delete_file(self, params: Dict[str, Any]) -> Dict[str, Any]:
        path = params.get("path")
        branch = params.get("branch") or "arena-manager"
        message = params.get("message") or f"chore(manager): delete {path}"
        if not path:
            raise ValueError("Parameter 'path' is required")

        cur = self._api_request(f"contents/{path}?ref={branch}")
        sha = cur.get("sha")
        if not sha:
            raise RuntimeError(f"File '{path}' does not exist on branch '{branch}'")

        payload = {"message": message, "sha": sha, "branch": branch}
        res = self._api_request(f"contents/{path}", method="DELETE", data=payload)
        return {"path": path, "branch": branch, "deleted": True}

    def create_pr(self, params: Dict[str, Any]) -> Dict[str, Any]:
        title = params.get("title")
        head = params.get("head") or params.get("branch")
        base = params.get("base") or "main"
        body = params.get("body") or ""
        if not title or not head:
            raise ValueError("Parameters 'title' and 'head' are required")

        payload = {"title": title, "head": head, "base": base, "body": body}
        res = self._api_request("pulls", method="POST", data=payload)
        return {
            "number": res.get("number"),
            "title": res.get("title"),
            "html_url": res.get("html_url"),
            "state": res.get("state"),
            "head": res.get("head", {}).get("ref"),
            "base": res.get("base", {}).get("ref")
        }

    def update_pr(self, params: Dict[str, Any]) -> Dict[str, Any]:
        pr_number = params.get("pr_number") or params.get("number")
        if not pr_number:
            raise ValueError("Parameter 'pr_number' is required")
        payload = {}
        if "title" in params:
            payload["title"] = params["title"]
        if "body" in params:
            payload["body"] = params["body"]
        if "state" in params:
            payload["state"] = params["state"]

        res = self._api_request(f"pulls/{pr_number}", method="PATCH", data=payload)
        return {
            "number": res.get("number"),
            "title": res.get("title"),
            "state": res.get("state"),
            "updated": True
        }

    def get_pr(self, params: Dict[str, Any]) -> Dict[str, Any]:
        pr_number = params.get("pr_number") or params.get("number")
        if not pr_number:
            raise ValueError("Parameter 'pr_number' is required")
        res = self._api_request(f"pulls/{pr_number}")
        return {
            "number": res.get("number"),
            "title": res.get("title"),
            "state": res.get("state"),
            "merged": res.get("merged", False),
            "mergeable": res.get("mergeable"),
            "merge_commit_sha": res.get("merge_commit_sha"),
            "head_sha": res.get("head", {}).get("sha"),
            "html_url": res.get("html_url")
        }

    def merge_pr(self, params: Dict[str, Any]) -> Dict[str, Any]:
        pr_number = params.get("pr_number") or params.get("number")
        method = params.get("merge_method") or "merge"
        if not pr_number:
            raise ValueError("Parameter 'pr_number' is required")

        payload = {"merge_method": method}
        if "commit_title" in params:
            payload["commit_title"] = params["commit_title"]

        res = self._api_request(f"pulls/{pr_number}/merge", method="PUT", data=payload)
        return {
            "number": pr_number,
            "merged": res.get("merged", True),
            "sha": res.get("sha"),
            "message": res.get("message")
        }

    def get_ci(self, params: Dict[str, Any]) -> Dict[str, Any]:
        ref = params.get("ref") or params.get("sha") or "main"
        res = self._api_request(f"commits/{ref}/check-runs")
        check_runs = []
        for cr in res.get("check_runs", []):
            check_runs.append({
                "id": cr.get("id"),
                "name": cr.get("name"),
                "status": cr.get("status"),
                "conclusion": cr.get("conclusion"),
                "html_url": cr.get("html_url")
            })
        return {
            "ref": ref,
            "total_count": res.get("total_count", len(check_runs)),
            "check_runs": check_runs
        }

    def commit_and_push(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Local git commit and push wrapper using injected credentials."""
        token = self._get_token()
        branch = params.get("branch") or "arena-manager"
        message = params.get("message") or "chore(manager): operational update"
        files = params.get("files") or []

        # Use git CLI with authenticated origin url
        remote_url = f"https://x-access-token:{token}@github.com/{self.repo_name}.git"

        for f in files:
            subprocess.run(["git", "add", f], cwd=self.repo_root, check=True)
        if not files:
            subprocess.run(["git", "add", "."], cwd=self.repo_root, check=True)

        commit_res = subprocess.run(["git", "commit", "-m", message], cwd=self.repo_root, capture_output=True, text=True)
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.repo_root, capture_output=True, text=True).stdout.strip()

        # Push using remote_url without mutating local remote permanently
        push_res = subprocess.run(["git", "push", remote_url, f"HEAD:{branch}"], cwd=self.repo_root, capture_output=True, text=True)
        if push_res.returncode != 0:
            raise RuntimeError(f"Git Push Failed: {self.sanitizer.sanitize_string(push_res.stderr)}")

        return {
            "branch": branch,
            "commit_sha": sha,
            "pushed": True
        }
