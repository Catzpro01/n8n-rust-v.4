import { CallerRole } from './types.ts';

/**
 * Autentikasi token untuk Gateway Edge Function.
 * Menggunakan token scoped (agm_ untuk manager, agw_ untuk worker).
 * Token ini TIDAK berisi credentials pihak ketiga.
 */
export class EdgeGatewayAuth {
  // Constant time string comparison untuk proteksi timing attack
  private static constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  static authenticateToken(
    bearerToken: string | null,
    callerId: string,
    managerSecretToken?: string,
    workerSecretToken?: string
  ): { ok: boolean; role?: CallerRole; reason?: string } {
    if (!bearerToken) {
      return { ok: false, reason: 'AUTHENTICATION_REQUIRED: Missing bearer token' };
    }

    const token = bearerToken.startsWith('Bearer ') ? bearerToken.slice(7).trim() : bearerToken.trim();

    // Default expected token dari environment jika di-set
    const expectedManagerToken = managerSecretToken || Deno.env.get('GATEWAY_MANAGER_TOKEN') || 'agm_arena_manager_master_key';
    const expectedWorkerToken = workerSecretToken || Deno.env.get('GATEWAY_WORKER_TOKEN') || 'agw_arena_worker_agent_fleet';

    if (this.constantTimeCompare(token, expectedManagerToken)) {
      if (callerId !== 'arena-manager') {
        return {
          ok: false,
          reason: `ROLE_MISMATCH: Manager token cannot be used by caller '${callerId}'`
        };
      }
      return { ok: true, role: 'manager' };
    }

    if (this.constantTimeCompare(token, expectedWorkerToken)) {
      if (!callerId.startsWith('arena-agent-') && !callerId.startsWith('worker-')) {
        return {
          ok: false,
          reason: `ROLE_MISMATCH: Worker token cannot be used by caller '${callerId}'`
        };
      }
      return { ok: true, role: 'worker' };
    }

    return { ok: false, reason: 'AUTHENTICATION_FAILED: Invalid gateway token' };
  }
}
