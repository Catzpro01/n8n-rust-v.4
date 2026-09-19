-- ==============================================================================
-- 20260920000000_dynamic_agent_fleet.sql
-- Canonical Migration for Phase S1: Dynamic Agent Fleet & Laptop Execution Pool
-- Non-destructive extension of public.agents and public.tasks
-- ==============================================================================

-- 1. EXTEND public.agents CHECK CONSTRAINT TO SUPPORT ALL S1 STATUSES
DO $$
BEGIN
    ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_status_check;
    ALTER TABLE public.agents ADD CONSTRAINT agents_status_check CHECK (status IN (
        'REGISTERING', 'AVAILABLE', 'CLAIMING', 'WORKING', 'WAITING_BUILD',
        'WAITING_AUDIT', 'BUILDING', 'TESTING', 'BLOCKED', 'DRAINING',
        'OFFLINE', 'ERROR'
    ));
END $$;

-- 2. EXTEND public.agents METADATA COLUMNS
ALTER TABLE public.agents
    ADD COLUMN IF NOT EXISTS hostname TEXT,
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS workspace_root TEXT,
    ADD COLUMN IF NOT EXISTS worker_version TEXT DEFAULT '1.0.0',
    ADD COLUMN IF NOT EXISTS execution_backend TEXT DEFAULT 'local_laptop',
    ADD COLUMN IF NOT EXISTS resource_capacity JSONB DEFAULT '{"cpu_count": 4, "memory_gb": 8, "build_slots": 1, "test_slots": 2}'::jsonb,
    ADD COLUMN IF NOT EXISTS active_build_slots INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS active_test_slots INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

-- 3. EXTEND public.tasks WITH CAPABILITY REQUIREMENTS
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS required_capabilities JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS preferred_capabilities JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS excluded_capabilities JSONB DEFAULT '[]'::jsonb;

-- 4. RPC: REGISTER OR UPDATE DYNAMIC AGENT
CREATE OR REPLACE FUNCTION public.register_dynamic_agent(
    p_agent_key TEXT,
    p_specialization_id UUID,
    p_capabilities JSONB DEFAULT '{}'::jsonb,
    p_hostname TEXT DEFAULT NULL,
    p_platform TEXT DEFAULT NULL,
    p_workspace_root TEXT DEFAULT NULL,
    p_worker_version TEXT DEFAULT '1.0.0',
    p_execution_backend TEXT DEFAULT 'local_laptop',
    p_resource_capacity JSONB DEFAULT '{"cpu_count": 4, "memory_gb": 8, "build_slots": 1, "test_slots": 2}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_agent RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_agent FROM public.agents WHERE agent_key = p_agent_key FOR UPDATE;

    IF FOUND THEN
        UPDATE public.agents
        SET specialization_id = COALESCE(p_specialization_id, v_agent.specialization_id),
            capabilities = COALESCE(p_capabilities, v_agent.capabilities),
            hostname = COALESCE(p_hostname, v_agent.hostname),
            platform = COALESCE(p_platform, v_agent.platform),
            workspace_root = COALESCE(p_workspace_root, v_agent.workspace_root),
            worker_version = COALESCE(p_worker_version, v_agent.worker_version),
            execution_backend = COALESCE(p_execution_backend, v_agent.execution_backend),
            resource_capacity = COALESCE(p_resource_capacity, v_agent.resource_capacity),
            status = 'AVAILABLE',
            last_heartbeat = v_now,
            updated_at = v_now,
            version = v_agent.version + 1
        WHERE id = v_agent.id
        RETURNING * INTO v_agent;

        RETURN jsonb_build_object('success', true, 'action', 'UPDATED', 'agent', row_to_json(v_agent));
    ELSE
        INSERT INTO public.agents (
            agent_key, specialization_id, status, capabilities, hostname, platform,
            workspace_root, worker_version, execution_backend, resource_capacity,
            last_heartbeat, version, created_at, updated_at
        ) VALUES (
            p_agent_key, p_specialization_id, 'AVAILABLE', COALESCE(p_capabilities, '{}'::jsonb),
            p_hostname, p_platform, p_workspace_root, p_worker_version, p_execution_backend,
            COALESCE(p_resource_capacity, '{"cpu_count": 4, "memory_gb": 8, "build_slots": 1, "test_slots": 2}'::jsonb),
            v_now, 0, v_now, v_now
        ) RETURNING * INTO v_agent;

        RETURN jsonb_build_object('success', true, 'action', 'REGISTERED', 'agent', row_to_json(v_agent));
    END IF;
END;
$$;

-- 5. RPC: WORKER HEARTBEAT WITH RESOURCE & STATE PROOF
CREATE OR REPLACE FUNCTION public.agent_heartbeat(
    p_agent_id UUID,
    p_worker_state TEXT DEFAULT NULL,
    p_current_task_id UUID DEFAULT NULL,
    p_active_build_slots INTEGER DEFAULT NULL,
    p_active_test_slots INTEGER DEFAULT NULL,
    p_resource_capacity JSONB DEFAULT NULL,
    p_worker_version TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_agent RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_FOUND');
    END IF;

    UPDATE public.agents
    SET last_heartbeat = v_now,
        status = CASE 
            WHEN p_worker_state IS NOT NULL THEN p_worker_state
            ELSE status
        END,
        current_task_id = CASE
            WHEN p_current_task_id IS NOT NULL THEN p_current_task_id
            ELSE current_task_id
        END,
        active_build_slots = COALESCE(p_active_build_slots, active_build_slots),
        active_test_slots = COALESCE(p_active_test_slots, active_test_slots),
        resource_capacity = COALESCE(p_resource_capacity, resource_capacity),
        worker_version = COALESCE(p_worker_version, worker_version),
        updated_at = v_now
    WHERE id = p_agent_id;

    RETURN jsonb_build_object(
        'success', true,
        'agent_id', p_agent_id,
        'timestamp', v_now,
        'status', COALESCE(p_worker_state, v_agent.status)
    );
END;
$$;

-- 6. RPC: DRAIN AGENT
CREATE OR REPLACE FUNCTION public.drain_agent(
    p_agent_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_agent RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_FOUND');
    END IF;

    -- If idle, transition straight to OFFLINE, if working transition to DRAINING
    IF v_agent.current_task_id IS NULL OR v_agent.status = 'AVAILABLE' THEN
        UPDATE public.agents
        SET status = 'OFFLINE', current_task_id = NULL, updated_at = v_now, version = version + 1
        WHERE id = p_agent_id;
        RETURN jsonb_build_object('success', true, 'status', 'OFFLINE');
    ELSE
        UPDATE public.agents
        SET status = 'DRAINING', updated_at = v_now, version = version + 1
        WHERE id = p_agent_id;
        RETURN jsonb_build_object('success', true, 'status', 'DRAINING');
    END IF;
END;
$$;

-- 7. GRANTS
GRANT EXECUTE ON FUNCTION public.register_dynamic_agent TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat TO service_role;
GRANT EXECUTE ON FUNCTION public.drain_agent TO service_role;
