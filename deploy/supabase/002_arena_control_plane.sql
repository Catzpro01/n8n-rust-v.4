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
