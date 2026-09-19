import { CallerRole } from './types.ts';

/**
 * Policy Engine di level Edge.
 * Memvalidasi hak akses role (Manager vs Worker) dan parameter target.
 */
export class EdgePolicyEngine {
  // Capabilities eksklusif untuk Manager
  private static readonly MANAGER_ONLY_CAPABILITIES = new Set([
    'github.create_branch',
    'github.delete_branch',
    'github.create_pr',
    'github.update_pr',
    'github.merge_pr',
    'github.commit_and_push',
    'telegram.send_message',
    'telegram.render_dashboard',
    'supabase.create_task',
    'supabase.update_task_state',
    'supabase.reap_expired_leases',
    'laptop.run_command'
  ]);

  // Cabang yang dilindungi (Strictly forbidden to modify/push directly)
  private static readonly PROTECTED_BRANCHES = new Set([
    'main',
    'master',
    'arena-agent'
  ]);

  // File yang dilindungi (Strictly forbidden to inspect/modify via gateway)
  private static readonly PROTECTED_FILES = new Set([
    '.env',
    '.env.local',
    '.env.production',
    '.credentials',
    'gateway_tokens.json',
    'id_rsa',
    'id_ed25519'
  ]);

  static evaluate(
    role: CallerRole,
    capability: string,
    params: Record<string, any> = {}
  ): { allowed: boolean; reason: string } {
    // 1. Validasi hak akses role
    if (role === 'worker' && this.MANAGER_ONLY_CAPABILITIES.has(capability)) {
      return {
        allowed: false,
        reason: `FORBIDDEN_ROLE: Worker agents cannot invoke manager capability '${capability}'`
      };
    }

    // 2. Proteksi Branch
    const branch = params.branch || params.target_branch || params.base_branch;
    if (branch && this.PROTECTED_BRANCHES.has(branch)) {
      const operation = capability.split('.')[1] || '';
      if (['delete_branch', 'merge_pr', 'commit_and_push'].includes(operation)) {
        return {
          allowed: false,
          reason: `PROTECTED_BRANCH: Operation '${capability}' is prohibited on protected branch '${branch}'`
        };
      }
    }

    // 3. Proteksi File Sensitif
    const path = params.path || params.file_path;
    if (path) {
      const lower = path.toLowerCase();
      for (const pf of this.PROTECTED_FILES) {
        if (lower.includes(pf.toLowerCase())) {
          return {
            allowed: false,
            reason: `PROTECTED_FILE: Access to sensitive file '${path}' is strictly blocked`
          };
        }
      }
    }

    return { allowed: true, reason: 'POLICY_ALLOWED' };
  }
}
