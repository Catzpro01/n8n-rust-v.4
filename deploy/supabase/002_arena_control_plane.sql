-- ==============================================================================
-- 002_arena_control_plane.sql
-- State Layer for 5 Arena Agents (Coordination, Distributed Locks & Leases)
-- Source of truth: GitHub. Supabase is Ephemeral / Coordination Layer only.
-- ==============================================================================

-- 1. Table: agents (Live registry and workspace status)
CREATE TABLE IF NOT EXISTS public.agents (
    id TEXT PRIMARY KEY,                       -- e.g. 'agent-01'..'agent-05'
    status TEXT NOT NULL DEFAULT 'IDLE',       -- IDLE, WORKING, BLOCKED, OFFLINE
    current_task_id TEXT,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    workspace_id TEXT NOT NULL DEFAULT '/srv/arena/workspaces/agent-01',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 5 Agents
INSERT INTO public.agents (id, status, workspace_id)
VALUES
    ('agent-01', 'IDLE', '/srv/arena/workspaces/agent-01'),
    ('agent-02', 'IDLE', '/srv/arena/workspaces/agent-02'),
    ('agent-03', 'IDLE', '/srv/arena/workspaces/agent-03'),
    ('agent-04', 'IDLE', '/srv/arena/workspaces/agent-04'),
    ('agent-05', 'IDLE', '/srv/arena/workspaces/agent-05')
ON CONFLICT (id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    updated_at = NOW();

-- 2. Table: task_leases (Sessionless recovery & lease expiration)
CREATE TABLE IF NOT EXISTS public.task_leases (
    task_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_duration_sec INTEGER NOT NULL DEFAULT 600
);

-- 3. Table: lego_locks (Resource locking per LEGO / Sub-LEGO)
CREATE TABLE IF NOT EXISTS public.lego_locks (
    resource_id TEXT PRIMARY KEY,              -- e.g. 'workflow.graph', 'expression.compiler'
    resource_type TEXT NOT NULL,               -- 'lego' or 'sublego'
    owner_agent TEXT NOT NULL,
    task_id TEXT NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_until TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 4. Table: heartbeats (Agent telemetry without polluting Git)
CREATE TABLE IF NOT EXISTS public.heartbeats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL,
    memory_mb INTEGER,
    cpu_percent REAL,
    current_task TEXT
);

-- 5. Table: execution_runs (Audit log for command execution via Arena Executor)
CREATE TABLE IF NOT EXISTS public.execution_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    command_hash TEXT NOT NULL,
    argv JSONB NOT NULL,
    status TEXT NOT NULL,                      -- RUNNING, SUCCESS, FAILED, TIMED_OUT
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    exit_code INTEGER,
    summary TEXT,
    log_path TEXT
);

-- 6. Table: task_events (Coordination bus events)
CREATE TABLE IF NOT EXISTS public.task_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,                  -- CLAIMED, LEASE_RENEWED, TEST_PASSED, PR_OPENED, COMPLETED, FAILED
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_task_leases_agent ON public.task_leases(agent_id, lease_until);
CREATE INDEX IF NOT EXISTS idx_lego_locks_owner ON public.lego_locks(owner_agent, lease_until);
CREATE INDEX IF NOT EXISTS idx_heartbeats_agent ON public.heartbeats(agent_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_execution_runs_task ON public.execution_runs(task_id, started_at DESC);

-- ==============================================================================
-- P0-6: ATOMIC LOCK ACQUISITION STORED PROCEDURE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.acquire_lego_lock(
    p_resource_id TEXT,
    p_resource_type TEXT,
    p_owner_agent TEXT,
    p_task_id TEXT,
    p_ttl_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_lease_until TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
    v_current_lock RECORD;
BEGIN
    SELECT * INTO v_current_lock
    FROM public.lego_locks
    WHERE resource_id = p_resource_id
    FOR UPDATE;

    IF FOUND THEN
        -- If lock is active and owned by another agent -> reject!
        IF v_current_lock.lease_until > v_now AND v_current_lock.owner_agent != p_owner_agent THEN
            RETURN jsonb_build_object(
                'acquired', false,
                'error', 'LOCKED_BY_OTHER_AGENT',
                'owner', v_current_lock.owner_agent,
                'lease_until', v_current_lock.lease_until
            );
        END IF;

        UPDATE public.lego_locks
        SET owner_agent = p_owner_agent,
            task_id = p_task_id,
            acquired_at = v_now,
            lease_until = v_lease_until
        WHERE resource_id = p_resource_id;

        RETURN jsonb_build_object('acquired', true, 'action', 'renewed', 'lease_until', v_lease_until);
    ELSE
        INSERT INTO public.lego_locks (resource_id, resource_type, owner_agent, task_id, acquired_at, lease_until)
        VALUES (p_resource_id, p_resource_type, p_owner_agent, p_task_id, v_now, v_lease_until);

        RETURN jsonb_build_object('acquired', true, 'action', 'acquired', 'lease_until', v_lease_until);
    END IF;
END;
$$;
-- ==============================================================================
-- P0-6 Extended: OWNER-AWARE LOCK RELEASE STORED PROCEDURE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.release_lego_lock(
    p_resource_id TEXT,
    p_owner_agent TEXT,
    p_task_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_lock RECORD;
BEGIN
    SELECT * INTO v_current_lock
    FROM public.lego_locks
    WHERE resource_id = p_resource_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('released', true, 'status', 'NOT_FOUND');
    END IF;

    -- Enforce ownership: only the owner agent can release the lock
    IF v_current_lock.owner_agent != p_owner_agent THEN
        RETURN jsonb_build_object(
            'released', false,
            'error', 'UNAUTHORIZED_OWNER_MISMATCH',
            'current_owner', v_current_lock.owner_agent
        );
    END IF;

    -- If task_id is provided, verify it matches
    IF p_task_id IS NOT NULL AND v_current_lock.task_id != p_task_id THEN
        RETURN jsonb_build_object(
            'released', false,
            'error', 'TASK_ID_MISMATCH',
            'current_task', v_current_lock.task_id
        );
    END IF;

    DELETE FROM public.lego_locks
    WHERE resource_id = p_resource_id;

    RETURN jsonb_build_object('released', true, 'status', 'RELEASED');
END;
$$;
-- ==============================================================================
-- P0 SECURITY: RLS ENFORCEMENT & PRIVILEGE LOCKDOWN
-- Prevent public/anon/authenticated access to control plane tables & RPCs.
-- Backend Bridge uses service_role key directly (bypassing RLS safely).
-- ==============================================================================

-- 1. Enable RLS on all control plane tables
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lego_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;

-- 2. Revoke all privileges on control plane tables from public, anon, and authenticated
REVOKE ALL ON TABLE public.agents FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.task_leases FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.lego_locks FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.heartbeats FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.execution_runs FROM anon, authenticated, public;
REVOKE ALL ON TABLE public.task_events FROM anon, authenticated, public;

-- Explicitly grant full permissions to service_role ONLY
GRANT ALL ON TABLE public.agents TO service_role;
GRANT ALL ON TABLE public.task_leases TO service_role;
GRANT ALL ON TABLE public.lego_locks TO service_role;
GRANT ALL ON TABLE public.heartbeats TO service_role;
GRANT ALL ON TABLE public.execution_runs TO service_role;
GRANT ALL ON TABLE public.task_events TO service_role;

-- 3. Revoke EXECUTE on stored procedures from public, anon, and authenticated
REVOKE EXECUTE ON FUNCTION public.acquire_lego_lock(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.release_lego_lock(TEXT, TEXT, TEXT) FROM anon, authenticated, public;

-- Explicitly grant EXECUTE to service_role ONLY
GRANT EXECUTE ON FUNCTION public.acquire_lego_lock(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_lego_lock(TEXT, TEXT, TEXT) TO service_role;
-- ==============================================================================
-- P0 ADDENDUM: WEBHOOK IDEMPOTENCY & LEASE REAPER PROCEDURE
-- ==============================================================================

-- 1. Table: processed_webhook_deliveries (Replay Attack & Duplicate Webhook Prevention)
CREATE TABLE IF NOT EXISTS public.processed_webhook_deliveries (
    delivery_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'PROCESSED'
);

ALTER TABLE public.processed_webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.processed_webhook_deliveries FROM anon, authenticated, public;
GRANT ALL ON TABLE public.processed_webhook_deliveries TO service_role;

-- 2. Stored Procedure: reap_expired_leases
-- Releases expired lego_locks and task_leases when an agent crashes or disconnects.
CREATE OR REPLACE FUNCTION public.reap_expired_leases()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_reaped_locks INTEGER := 0;
    v_reaped_tasks INTEGER := 0;
BEGIN
    -- Delete expired lego locks
    WITH deleted_locks AS (
        DELETE FROM public.lego_locks
        WHERE lease_until < v_now
        RETURNING resource_id
    )
    SELECT COUNT(*) INTO v_reaped_locks FROM deleted_locks;

    -- Delete expired task leases
    WITH deleted_tasks AS (
        DELETE FROM public.task_leases
        WHERE lease_until < v_now
        RETURNING task_id
    )
    SELECT COUNT(*) INTO v_reaped_tasks FROM deleted_tasks;

    RETURN jsonb_build_object(
        'success', true,
        'reaped_locks_count', v_reaped_locks,
        'reaped_tasks_count', v_reaped_tasks,
        'timestamp', v_now
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reap_expired_leases() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.reap_expired_leases() TO service_role;
