import { Hono } from 'npm:hono';
import { withSupabase } from 'npm:@supabase/server/adapters/hono';

// Capability Gateway Types
export type CallerRole = 'manager' | 'worker' | 'untrusted';

export interface GatewayAuthRecord {
  role: CallerRole;
  allowed_prefix: string;
}

export interface CapabilityInvokeRequest {
  caller_id: string;
  capability: string;
  params?: Record<string, any>;
  task_id?: string;
  request_id?: string;
  timestamp?: number;
}

export interface CapabilityInvokeResponse {
  ok: boolean;
  authenticated: boolean;
  authorized: boolean;
  error?: string;
  result?: any;
  request_id?: string;
  execution_location?: 'edge_function' | 'trusted_runtime_forward';
  sanitized?: boolean;
}
