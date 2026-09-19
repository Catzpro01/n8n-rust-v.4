-- ==============================================================================
-- ARENA CONTROL PLANE: RECOVERY PLANE & TASK HANDOVER MIGRATION
-- Architecture: 1 Supabase Project with 3 Logical Planes
-- 1. CONTROL PLANE: Task Lease, Expiration & Ownership Fencing
-- 2. RECOVERY PLANE: Handovers, Checkpoints & Recovery Attempts
-- 3. EVIDENCE PLANE: Retained & Linked to Historical Runs
-- ==============================================================================

-- 1. CONTROL PLANE EXTENSIONS: Add lease support to public.tasks
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_lease_expires ON public.tasks(lease_expires_at);

-- Expand tasks status CHECK constraint to include 'RECLAIMABLE' if needed
DO $$
BEGIN
    ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
        'QUEUED', 'CLAIMED', 'IN_PROGRESS', 'WORKING', 'PR_OPEN',
        'BUILDING', 'BUILD_FAILED', 'TESTING', 'TEST_FAILED',
        'AUDITING', 'AUDIT_FAILED', 'READY_TO_MERGE', 'MERGING',
        'MERGED', 'POST_MERGE_VERIFY', 'CLEANUP', 'DONE', 'COMPLETED',
        'BLOCKED', 'FAILED', 'STALE', 'BACKLOG', 'CANCELLED', 'RECLAIMABLE'
    ));
END $$;

-- 2. RECOVERY PLANE TABLES

-- 2.1 HANDOVER EVENTS (Audit trail of task handovers between agents)
CREATE TABLE IF NOT EXISTS public.handover_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    previous_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    new_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    old_version BIGINT NOT NULL,
    new_version BIGINT NOT NULL,
    previous_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handover_task ON public.handover_events(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handover_prev_agent ON public.handover_events(previous_agent_id);
CREATE INDEX IF NOT EXISTS idx_handover_new_agent ON public.handover_events(new_agent_id);

-- 2.2 AGENT CHECKPOINTS (Progress state & work-in-progress snapshots per task)
CREATE TABLE IF NOT EXISTS public.agent_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    checkpoint_type TEXT NOT NULL DEFAULT 'PROGRESS' CHECK (checkpoint_type IN ('PROGRESS', 'HEARTBEAT', 'PRE_COMMIT', 'PRE_RECOVERY', 'HANDOVER')),
    description TEXT,
    current_commit_sha TEXT,
    branch_name TEXT NOT NULL,
    files_changed JSONB NOT NULL DEFAULT '[]'::jsonb,
    completed_work TEXT,
    remaining_work TEXT,
    test_status TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON public.agent_checkpoints(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON public.agent_checkpoints(agent_id);

-- 2.3 RECOVERY ATTEMPTS (Record of recovery executions)
CREATE TABLE IF NOT EXISTS public.recovery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    previous_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    new_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    attempt_status TEXT NOT NULL CHECK (attempt_status IN ('INITIATED', 'SUCCEEDED', 'FAILED')),
    reason TEXT NOT NULL,
    error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recovery_attempts_task ON public.recovery_attempts(task_id, created_at DESC);

-- 3. REVISED RPC 1: CLAIM TASK (Supports lease_duration_seconds and updates lease_expires_at)
CREATE OR REPLACE FUNCTION public.claim_task(
    p_task_id UUID,
    p_agent_id UUID,
    p_expected_version BIGINT,
    p_lease_seconds INTEGER DEFAULT 600
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_agent RECORD;
    v_new_version BIGINT;
    v_lock_conflict RECORD;
    v_now TIMESTAMPTZ := NOW();
    v_lease_expiry TIMESTAMPTZ;
BEGIN
    v_lease_expiry := v_now + (COALESCE(p_lease_seconds, 600) || ' seconds')::INTERVAL;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.status = 'CLAIMED' AND v_task.assigned_agent_id = p_agent_id THEN
        -- Idempotent renewal
        UPDATE public.tasks SET lease_expires_at = v_lease_expiry, last_heartbeat = v_now, updated_at = v_now WHERE id = p_task_id;
        RETURN jsonb_build_object('success', true, 'action', 'IDEMPOTENT_RETURN', 'version', v_task.version, 'lease_expires_at', v_lease_expiry);
    END IF;
    IF v_task.status != 'QUEUED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATE', 'current_status', v_task.status);
    END IF;
    IF v_task.version != p_expected_version THEN
        RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version);
    END IF;

    SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_FOUND'); END IF;
    IF v_agent.status != 'AVAILABLE' AND v_agent.status != 'CLAIMING' THEN
        RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_AVAILABLE', 'agent_status', v_agent.status);
    END IF;
    IF v_task.specialization_id != v_agent.specialization_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'SPECIALIZATION_MISMATCH');
    END IF;

    SELECT l.* INTO v_lock_conflict
    FROM public.task_files tf
    JOIN public.locks l ON l.resource = 'file:' || tf.file_path
    WHERE tf.task_id = p_task_id AND tf.access_mode = 'exclusive' AND l.expires_at > NOW() AND l.task_id != p_task_id
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'LOCK_CONFLICT', 'conflicting_resource', v_lock_conflict.resource);
    END IF;

    v_new_version := v_task.version + 1;
    UPDATE public.tasks
    SET status = 'CLAIMED',
        assigned_agent_id = p_agent_id,
        claimed_at = v_now,
        last_heartbeat = v_now,
        lease_expires_at = v_lease_expiry,
        version = v_new_version,
        updated_at = v_now
    WHERE id = p_task_id;

    UPDATE public.agents
    SET status = 'WORKING', current_task_id = p_task_id, version = v_agent.version + 1, last_heartbeat = v_now, updated_at = v_now
    WHERE id = p_agent_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, 'QUEUED', 'CLAIMED', 'ARENA_AGENT', p_agent_id::text, p_expected_version, v_new_version, 'Task claimed successfully'
    );

    RETURN jsonb_build_object('success', true, 'status', 'CLAIMED', 'version', v_new_version, 'lease_expires_at', v_lease_expiry);
END;
$$;

-- 4. REVISED RPC 13: REAP EXPIRED LEASES (Detects dead agents / expired task leases & transitions tasks to RECLAIMABLE)
CREATE OR REPLACE FUNCTION public.reap_expired_leases()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_reaped_locks INTEGER := 0;
    v_reaped_agents INTEGER := 0;
    v_reclaimed_tasks INTEGER := 0;
    v_t RECORD;
    v_new_version BIGINT;
BEGIN
    -- 1. Clean up expired file/resource locks
    WITH deleted_locks AS (
        DELETE FROM public.locks WHERE expires_at < v_now RETURNING resource
    )
    SELECT COUNT(*) INTO v_reaped_locks FROM deleted_locks;

    -- 2. Transition tasks with expired lease or dead agent to RECLAIMABLE
    FOR v_t IN
        SELECT t.*, a.status AS agent_status, a.last_heartbeat AS agent_last_heartbeat
        FROM public.tasks t
        LEFT JOIN public.agents a ON t.assigned_agent_id = a.id
        WHERE t.status IN ('CLAIMED', 'WORKING', 'BUILDING', 'TESTING', 'AUDITING')
          AND (
              (t.lease_expires_at IS NOT NULL AND t.lease_expires_at < v_now)
              OR
              (a.last_heartbeat IS NOT NULL AND a.last_heartbeat < (v_now - INTERVAL '10 minutes'))
              OR
              (a.status = 'OFFLINE')
          )
        FOR UPDATE OF t
    LOOP
        v_new_version := v_t.version + 1;

        UPDATE public.tasks
        SET status = 'RECLAIMABLE',
            version = v_new_version,
            updated_at = v_now
        WHERE id = v_t.id;

        -- Release any exclusive locks held by this abandoned task
        DELETE FROM public.locks WHERE task_id = v_t.id;

        -- Record handover state transition
        INSERT INTO public.task_state_transitions (
            task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason, metadata
        ) VALUES (
            v_t.id, v_t.status, 'RECLAIMABLE', 'SYSTEM', 'reap_expired_leases', v_t.version, v_new_version,
            'Task lease expired or agent unresponsive',
            jsonb_build_object('previous_agent_id', v_t.assigned_agent_id, 'agent_status', v_t.agent_status)
        );

        -- Record handover event in Recovery Plane
        INSERT INTO public.handover_events (
            task_id, previous_agent_id, new_agent_id, reason, old_version, new_version, previous_status, new_status, metadata
        ) VALUES (
            v_t.id, v_t.assigned_agent_id, NULL, 'LEASE_OR_HEARTBEAT_EXPIRED', v_t.version, v_new_version, v_t.status, 'RECLAIMABLE',
            jsonb_build_object('reaped_at', v_now, 'lease_expires_at', v_t.lease_expires_at)
        );

        v_reclaimed_tasks := v_reclaimed_tasks + 1;
    END LOOP;

    -- 3. Mark unresponsive agents as OFFLINE
    WITH offline_agents AS (
        UPDATE public.agents
        SET status = 'OFFLINE', version = version + 1, updated_at = v_now
        WHERE last_heartbeat < (v_now - INTERVAL '10 minutes')
          AND status IN ('AVAILABLE', 'WORKING', 'WAITING_BUILD', 'WAITING_AUDIT', 'CLAIMING')
        RETURNING id
    )
    SELECT COUNT(*) INTO v_reaped_agents FROM offline_agents;

    RETURN jsonb_build_object(
        'success', true,
        'reaped_locks_count', v_reaped_locks,
        'offline_agents_count', v_reaped_agents,
        'reclaimable_tasks_count', v_reclaimed_tasks,
        'timestamp', v_now
    );
END;
$$;

-- 5. NEW RPC 19: RECLAIM TASK (Atomic takeover of RECLAIMABLE task with OCC and Recovery Plane logging)
CREATE OR REPLACE FUNCTION public.reclaim_task(
    p_task_id UUID,
    p_new_agent_id UUID,
    p_expected_version BIGINT,
    p_lease_seconds INTEGER DEFAULT 600
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_agent RECORD;
    v_prev_agent_id UUID;
    v_new_version BIGINT;
    v_now TIMESTAMPTZ := NOW();
    v_lease_expiry TIMESTAMPTZ;
    v_lock_conflict RECORD;
BEGIN
    v_lease_expiry := v_now + (COALESCE(p_lease_seconds, 600) || ' seconds')::INTERVAL;

    -- Lock target task
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND');
    END IF;

    -- Only RECLAIMABLE tasks may be reclaimed
    IF v_task.status != 'RECLAIMABLE' THEN
        RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_RECLAIMABLE', 'current_status', v_task.status);
    END IF;

    -- OCC Versioning enforcement
    IF v_task.version != p_expected_version THEN
        RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version);
    END IF;

    -- Lock and validate new agent
    SELECT * INTO v_agent FROM public.agents WHERE id = p_new_agent_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_FOUND');
    END IF;

    IF v_agent.status != 'AVAILABLE' AND v_agent.status != 'CLAIMING' THEN
        RETURN jsonb_build_object('success', false, 'error', 'AGENT_NOT_AVAILABLE', 'agent_status', v_agent.status);
    END IF;

    IF v_task.specialization_id != v_agent.specialization_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'SPECIALIZATION_MISMATCH');
    END IF;

    -- Check resource collision
    SELECT l.* INTO v_lock_conflict
    FROM public.task_files tf
    JOIN public.locks l ON l.resource = 'file:' || tf.file_path
    WHERE tf.task_id = p_task_id AND tf.access_mode = 'exclusive' AND l.expires_at > v_now AND l.task_id != p_task_id
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'LOCK_CONFLICT', 'conflicting_resource', v_lock_conflict.resource);
    END IF;

    v_prev_agent_id := v_task.assigned_agent_id;
    v_new_version := v_task.version + 1;

    -- Release previous agent if still referenced
    IF v_prev_agent_id IS NOT NULL THEN
        UPDATE public.agents
        SET current_task_id = NULL,
            status = CASE WHEN status = 'WORKING' THEN 'OFFLINE' ELSE status END,
            version = version + 1,
            updated_at = v_now
        WHERE id = v_prev_agent_id;
    END IF;

    -- Update Task to CLAIMED under new owner
    UPDATE public.tasks
    SET assigned_agent_id = p_new_agent_id,
        status = 'CLAIMED',
        version = v_new_version,
        claimed_at = v_now,
        last_heartbeat = v_now,
        lease_expires_at = v_lease_expiry,
        updated_at = v_now
    WHERE id = p_task_id;

    -- Update New Agent
    UPDATE public.agents
    SET status = 'WORKING',
        current_task_id = p_task_id,
        version = version + 1,
        last_heartbeat = v_now,
        updated_at = v_now
    WHERE id = p_new_agent_id;

    -- Audit in task_state_transitions
    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason, metadata
    ) VALUES (
        p_task_id, 'RECLAIMABLE', 'CLAIMED', 'ARENA_AGENT', p_new_agent_id::text, p_expected_version, v_new_version,
        'Task reclaimed by replacement agent',
        jsonb_build_object('previous_agent_id', v_prev_agent_id, 'new_agent_id', p_new_agent_id)
    );

    -- Log Handover Event
    INSERT INTO public.handover_events (
        task_id, previous_agent_id, new_agent_id, reason, old_version, new_version, previous_status, new_status, metadata
    ) VALUES (
        p_task_id, v_prev_agent_id, p_new_agent_id, 'AGENT_RECLAIMED', p_expected_version, v_new_version, 'RECLAIMABLE', 'CLAIMED',
        jsonb_build_object('reclaimed_at', v_now, 'lease_expires_at', v_lease_expiry)
    );

    -- Log Recovery Attempt Success
    INSERT INTO public.recovery_attempts (
        task_id, previous_agent_id, new_agent_id, attempt_status, reason, created_at, completed_at
    ) VALUES (
        p_task_id, v_prev_agent_id, p_new_agent_id, 'SUCCEEDED', 'Task successfully reclaimed via OCC', v_now, v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', 'CLAIMED',
        'previous_agent_id', v_prev_agent_id,
        'new_agent_id', p_new_agent_id,
        'version', v_new_version,
        'lease_expires_at', v_lease_expiry
    );
END;
$$;

-- 6. NEW RPC 20: CREATE AGENT CHECKPOINT (Recovery Plane work-in-progress state preservation)
CREATE OR REPLACE FUNCTION public.create_agent_checkpoint(
    p_task_id UUID,
    p_agent_id UUID,
    p_checkpoint_type TEXT,
    p_description TEXT,
    p_current_commit_sha TEXT,
    p_branch_name TEXT,
    p_files_changed JSONB DEFAULT '[]'::jsonb,
    p_completed_work TEXT DEFAULT NULL,
    p_remaining_work TEXT DEFAULT NULL,
    p_test_status TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_checkpoint_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND');
    END IF;

    -- Verify agent ownership
    IF v_task.assigned_agent_id != p_agent_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_TASK_OWNER');
    END IF;

    INSERT INTO public.agent_checkpoints (
        task_id, agent_id, checkpoint_type, description, current_commit_sha, branch_name,
        files_changed, completed_work, remaining_work, test_status, metadata, created_at
    ) VALUES (
        p_task_id, p_agent_id, p_checkpoint_type, p_description, p_current_commit_sha, p_branch_name,
        COALESCE(p_files_changed, '[]'::jsonb), p_completed_work, p_remaining_work, p_test_status,
        COALESCE(p_metadata, '{}'::jsonb), v_now
    ) RETURNING id INTO v_checkpoint_id;

    -- Also update task's heartbeat and commit sha if provided
    UPDATE public.tasks
    SET last_heartbeat = v_now,
        current_commit_sha = COALESCE(p_current_commit_sha, current_commit_sha),
        updated_at = v_now
    WHERE id = p_task_id;

    RETURN jsonb_build_object('success', true, 'checkpoint_id', v_checkpoint_id, 'created_at', v_now);
END;
$$;

-- 7. NEW RPC 21: GET TASK RECOVERY CONTEXT (Provides successor agent complete handoff packet)
CREATE OR REPLACE FUNCTION public.get_task_recovery_context(
    p_task_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_task RECORD;
    v_last_checkpoint RECORD;
    v_last_build RECORD;
    v_last_test RECORD;
    v_last_audit RECORD;
    v_last_handover RECORD;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND');
    END IF;

    SELECT * INTO v_last_checkpoint
    FROM public.agent_checkpoints
    WHERE task_id = p_task_id
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT * INTO v_last_build
    FROM public.build_jobs
    WHERE task_id = p_task_id
    ORDER BY started_at DESC
    LIMIT 1;

    SELECT * INTO v_last_test
    FROM public.test_results
    WHERE task_id = p_task_id
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT * INTO v_last_audit
    FROM public.audit_results
    WHERE task_id = p_task_id
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT * INTO v_last_handover
    FROM public.handover_events
    WHERE task_id = p_task_id
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'success', true,
        'task', jsonb_build_object(
            'id', v_task.id,
            'task_key', v_task.task_key,
            'status', v_task.status,
            'assigned_agent_id', v_task.assigned_agent_id,
            'branch_name', v_task.branch_name,
            'base_commit', v_task.base_commit,
            'current_commit_sha', v_task.current_commit_sha,
            'version', v_task.version,
            'lease_expires_at', v_task.lease_expires_at
        ),
        'latest_checkpoint', CASE WHEN v_last_checkpoint IS NOT NULL THEN row_to_json(v_last_checkpoint)::jsonb ELSE NULL END,
        'latest_build', CASE WHEN v_last_build IS NOT NULL THEN row_to_json(v_last_build)::jsonb ELSE NULL END,
        'latest_test', CASE WHEN v_last_test IS NOT NULL THEN row_to_json(v_last_test)::jsonb ELSE NULL END,
        'latest_audit', CASE WHEN v_last_audit IS NOT NULL THEN row_to_json(v_last_audit)::jsonb ELSE NULL END,
        'latest_handover', CASE WHEN v_last_handover IS NOT NULL THEN row_to_json(v_last_handover)::jsonb ELSE NULL END
    );
END;
$$;

-- 8. RLS POLICIES FOR RECOVERY PLANE
ALTER TABLE public.handover_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.handover_events FROM anon, authenticated, public;
REVOKE ALL ON public.agent_checkpoints FROM anon, authenticated, public;
REVOKE ALL ON public.recovery_attempts FROM anon, authenticated, public;

GRANT ALL ON public.handover_events TO service_role;
GRANT ALL ON public.agent_checkpoints TO service_role;
GRANT ALL ON public.recovery_attempts TO service_role;
