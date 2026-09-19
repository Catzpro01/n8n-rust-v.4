import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { withSupabase } from 'npm:@supabase/server/adapters/hono';
import { EdgeGatewayAuth } from './auth.ts';
import { EdgePolicyEngine } from './policy.ts';
import { EdgeSanitizer } from './sanitizer.ts';
import { CapabilityInvokeRequest, CapabilityInvokeResponse } from './types.ts';

const app = new Hono();

app.use('*', cors());
app.use('*', withSupabase({ auth: 'none' }));

// Capabilities yang langsung dilayani di Edge via PostgreSQL Control Plane
const EDGE_NATIVE_CAPABILITIES = new Set([
  'supabase.read_table',
  'supabase.write_table',
  'supabase.rpc',
  'supabase.inspect_tasks',
  'supabase.inspect_agents',
  'supabase.inspect_locks',
  'supabase.create_task',
  'supabase.update_task_state',
  'supabase.record_event',
  'supabase.get_project_state',
  'supabase.register_worker',
  'supabase.claim_task_lease',
  'supabase.worker_heartbeat',
  'supabase.reap_expired_leases',
  'supabase.record_checkpoint',
]);

// Capabilities yang didelegasikan ke Trusted Runtime (Persistent Gateway)
const TRUSTED_RUNTIME_CAPABILITIES = new Set([
  'github.read_repo',
  'github.list_branches',
  'github.get_branch',
  'github.create_branch',
  'github.delete_branch',
  'github.read_file',
  'github.write_file',
  'github.delete_file',
  'github.create_pr',
  'github.update_pr',
  'github.get_pr',
  'github.merge_pr',
  'github.get_ci',
  'github.commit_and_push',
  'telegram.send_message',
  'telegram.get_updates',
  'telegram.render_dashboard',
  'laptop.status',
  'laptop.run_test',
  'laptop.run_build',
  'laptop.run_clippy',
  'laptop.run_command',
]);

// 1. Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'HEALTHY',
    service: 'supabase-edge-capability-gateway',
    version: '1.8.0',
    timestamp: new Date().toISOString(),
  });
});

// 2. Discover capabilities
app.get('/capabilities', (c) => {
  return c.json({
    version: '1.8.0',
    edge_native_count: EDGE_NATIVE_CAPABILITIES.size,
    trusted_runtime_forward_count: TRUSTED_RUNTIME_CAPABILITIES.size,
    edge_capabilities: Array.from(EDGE_NATIVE_CAPABILITIES),
    trusted_runtime_capabilities: Array.from(TRUSTED_RUNTIME_CAPABILITIES),
  });
});

// 3. Central capability invocation
app.post('/invoke', async (c) => {
  const authHeader = c.req.header('Authorization') || null;
  const callerHeader = c.req.header('X-Caller-ID') || null;

  let body: CapabilityInvokeRequest;
  try {
    body = await c.req.json();
  } catch (err) {
    return c.json(
      { ok: false, authenticated: false, authorized: false, error: 'Malformed JSON payload' },
      400
    );
  }

  const callerId = callerHeader || body.caller_id;
  const capability = body.capability;
  const params = body.params || {};
  const requestId = body.request_id || `edge-${crypto.randomUUID()}`;

  if (!callerId || !capability) {
    return c.json(
      { ok: false, authenticated: false, authorized: false, error: 'Missing caller_id or capability' },
      400
    );
  }

  // A. Authenticate
  const authRes = EdgeGatewayAuth.authenticateToken(authHeader, callerId);
  if (!authRes.ok || !authRes.role) {
    return c.json(
      { ok: false, authenticated: false, authorized: false, error: authRes.reason },
      401
    );
  }

  // B. Authorize (Policy Engine)
  const policyRes = EdgePolicyEngine.evaluate(authRes.role, capability, params);
  if (!policyRes.allowed) {
    return c.json(
      { ok: false, authenticated: true, authorized: false, error: policyRes.reason },
      403
    );
  }

  const { supabase } = (c.var as any).supabaseContext;

  // C. Execute Edge Native (Direct PostgreSQL / PostgREST)
  if (EDGE_NATIVE_CAPABILITIES.has(capability)) {
    try {
      let result: any = null;

      if (capability === 'supabase.inspect_tasks') {
        const { data, error } = await supabase
          .from('tasks')
          .select('id,task_key,category,status,priority,assigned_agent,version')
          .order('priority', { ascending: false });
        if (error) throw error;
        result = { tasks: data, count: data?.length || 0 };
      } else if (capability === 'supabase.inspect_agents') {
        const { data, error } = await supabase
          .from('agents')
          .select('id,agent_key,role,status,last_heartbeat_at')
          .order('agent_key');
        if (error) throw error;
        result = { agents: data, total_agents: data?.length || 0 };
      } else if (capability === 'supabase.get_project_state') {
        const { data: tasks, error: tErr } = await supabase.from('tasks').select('status');
        if (tErr) throw tErr;
        const counts: Record<string, number> = {};
        for (const t of tasks || []) {
          counts[t.status] = (counts[t.status] || 0) + 1;
        }
        result = { task_counts: counts, total_tasks: tasks?.length || 0 };
      } else if (capability === 'supabase.claim_task_lease') {
        const { data, error } = await supabase.rpc('claim_task', {
          p_task_key: params.task_key,
          p_agent_key: callerId,
          p_expected_version: params.expected_version || 1,
          p_lease_seconds: params.lease_seconds || 300,
        });
        if (error) throw error;
        result = data;
      } else if (capability === 'supabase.worker_heartbeat') {
        const { data, error } = await supabase.rpc('agent_heartbeat', {
          p_agent_key: callerId,
        });
        if (error) throw error;
        result = { status: 'HEARTBEAT_ACK', details: data };
      } else if (capability === 'supabase.reap_expired_leases') {
        const { data, error } = await supabase.rpc('reap_expired_leases');
        if (error) throw error;
        result = { reaped: data };
      } else if (capability === 'supabase.register_worker') {
        const { data, error } = await supabase.rpc('register_dynamic_agent', {
          p_agent_key: params.agent_key || callerId,
          p_role: params.role || 'worker',
          p_capabilities: params.capabilities || ['cargo_test'],
        });
        if (error) throw error;
        result = data;
      } else if (capability === 'supabase.read_table') {
        const { data, error } = await supabase
          .from(params.table)
          .select(params.select || '*')
          .limit(params.limit || 50);
        if (error) throw error;
        result = data;
      } else {
        return c.json(
          { ok: false, authenticated: true, authorized: true, error: `Edge handler for '${capability}' not implemented` },
          501
        );
      }

      // Record Audit Log to 'events' table asynchronously
      await supabase.from('events').insert({
        event_type: 'CAPABILITY_INVOCATION',
        agent_key: callerId,
        payload: {
          capability,
          request_id: requestId,
          location: 'edge_function',
          success: true,
        },
      });

      const sanitizedResult = EdgeSanitizer.sanitize(result);
      const response: CapabilityInvokeResponse = {
        ok: true,
        authenticated: true,
        authorized: true,
        execution_location: 'edge_function',
        request_id: requestId,
        result: sanitizedResult,
      };
      return c.json(response);
    } catch (err: any) {
      return c.json(
        {
          ok: false,
          authenticated: true,
          authorized: true,
          execution_location: 'edge_function',
          error: err.message || String(err),
          request_id: requestId,
        },
        500
      );
    }
  }

  // D. Forward to Trusted Runtime (Laptop / Persistent Gateway)
  if (TRUSTED_RUNTIME_CAPABILITIES.has(capability)) {
    const trustedGatewayUrl = Deno.env.get('TRUSTED_RUNTIME_GATEWAY_URL') || 'http://127.0.0.1:8787';

    try {
      const forwardRes = await fetch(`${trustedGatewayUrl}/api/v1/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caller-ID': callerId,
          Authorization: authHeader || '',
          'X-Forwarded-From': 'supabase-edge-gateway',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify({
          caller_id: callerId,
          capability,
          params,
          request_id: requestId,
        }),
      });

      const runtimeData = await forwardRes.json();
      const sanitized = EdgeSanitizer.sanitize(runtimeData);

      return c.json({
        ...sanitized,
        execution_location: 'trusted_runtime_forward',
        request_id: requestId,
      });
    } catch (err: any) {
      return c.json(
        {
          ok: false,
          authenticated: true,
          authorized: true,
          execution_location: 'trusted_runtime_forward',
          error: `FORWARDING_FAILED: Could not reach trusted runtime gateway: ${err.message}`,
          request_id: requestId,
        },
        502
      );
    }
  }

  return c.json(
    { ok: false, authenticated: true, authorized: true, error: `UNKNOWN_CAPABILITY: '${capability}'` },
    404
  );
});

export default { fetch: app.fetch };
