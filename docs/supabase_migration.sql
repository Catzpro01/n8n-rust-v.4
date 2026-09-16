-- ==============================================================================
-- N8N-RUST V4: ARENA 5-AGENT COMMUNICATION & ORCHESTRATION SCHEMA
-- Compatible with Supabase Postgres
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLE: tasks
CREATE TABLE IF NOT EXISTS public.tasks (
    id TEXT PRIMARY KEY,                       -- e.g. 'TASK-201'
    agent_id TEXT NOT NULL,                    -- e.g. 'agent-1'
    module TEXT NOT NULL,                     -- e.g. 'workflow'
    phase INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PENDING',    -- PENDING, RUNNING, COMPLETED, FAILED, BLOCKED
    spec JSONB NOT NULL DEFAULT '{}'::jsonb,   -- Task instructions & payload
    result JSONB DEFAULT '{}'::jsonb,          -- Execution outputs & metrics
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TABLE: agent_messages (Inter-Agent Bus)
CREATE TABLE IF NOT EXISTS public.agent_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id TEXT NOT NULL,                   -- agent-1..agent-5, gateway, mediator
    recipient_id TEXT NOT NULL,                -- agent-1..agent-5, broadcast, mediator
    message_type TEXT NOT NULL,                -- DEPENDENCY_REQUEST, DEPENDENCY_RESPONSE, CONTRACT_VALIDATION, LOCK_RELEASED, STATUS_REPORT
    subject TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'UNREAD',     -- UNREAD, PROCESSED, REJECTED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TABLE: agent_dependencies (Contract Dependency Tracking)
CREATE TABLE IF NOT EXISTS public.agent_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_agent TEXT NOT NULL,             -- e.g. agent-3
    provider_agent TEXT NOT NULL,              -- e.g. agent-1
    contract_name TEXT NOT NULL,               -- e.g. workflow.contract.md
    interface_symbol TEXT NOT NULL,            -- e.g. Workflow::get_node_metadata
    status TEXT NOT NULL DEFAULT 'PENDING',    -- PENDING, ACCEPTED, REJECTED, VERIFIED_BY_AGENT_5
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TABLE: locks (Single LEGO Lock Engine)
CREATE TABLE IF NOT EXISTS public.locks (
    module TEXT PRIMARY KEY,                   -- e.g. 'workflow', 'node', 'graph'
    owner TEXT NOT NULL,                       -- e.g. 'agent-1'
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ttl_seconds INTEGER NOT NULL DEFAULT 3600,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 6. TABLE: agent_status (Agent Heartbeat & Live Registry)
CREATE TABLE IF NOT EXISTS public.agent_status (
    agent_id TEXT PRIMARY KEY,                 -- agent-1..agent-5
    current_task TEXT REFERENCES public.tasks(id) ON DELETE SET NULL,
    current_lego TEXT,
    state TEXT NOT NULL DEFAULT 'IDLE',        -- IDLE, BUSY, BLOCKED, ERROR
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metrics JSONB DEFAULT '{}'::jsonb
);

-- 7. INITIAL SEED FOR AGENTS
INSERT INTO public.agent_status (agent_id, current_lego, state)
VALUES
    ('agent-1', 'workflow', 'IDLE'),
    ('agent-2', 'node', 'IDLE'),
    ('agent-3', 'engine', 'IDLE'),
    ('agent-4', 'storage', 'IDLE'),
    ('agent-5', 'mediator', 'IDLE')
ON CONFLICT (agent_id) DO NOTHING;

-- 8. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON public.tasks(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient ON public.agent_messages(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_sender ON public.agent_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_agent_dependencies_agents ON public.agent_dependencies(requester_agent, provider_agent);

-- 9. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_status ENABLE ROW LEVEL SECURITY;

-- Allow full access to service_role
CREATE POLICY "service_role_tasks_all" ON public.tasks TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_messages_all" ON public.agent_messages TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_dependencies_all" ON public.agent_dependencies TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_locks_all" ON public.locks TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_status_all" ON public.agent_status TO service_role USING (true) WITH CHECK (true);

-- Allow authenticated / anon read access (for dashboards or webhook queries if needed)
CREATE POLICY "anon_read_tasks" ON public.tasks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_messages" ON public.agent_messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_dependencies" ON public.agent_dependencies FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_locks" ON public.locks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_read_status" ON public.agent_status FOR SELECT TO anon, authenticated USING (true);
