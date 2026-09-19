-- ==============================================================================
-- 20260919000000_arena_orchestration_control_plane.sql
-- Canonical Supabase Control Plane Schema & Atomic State Transition Contract
-- Architecture: GitHub (Code Source of Truth) x Supabase (Control Plane) x Laptop (Build Worker)
-- 
-- MIGRATION AUDIT CLASSIFICATION:
-- 1. Canonical Source: `supabase/migrations/` is the SOLE source of truth for new migrations.
-- 2. Legacy Artefacts:
--    - `docs/supabase_migration.sql` (Deprecated: 5-agent schema, replaced by this canonical migration)
--    - `deploy/supabase/002_arena_control_plane.sql` (Deprecated: legacy VPS paths, replaced by this canonical migration)
--    Both files are retained strictly for archival reference and must not be executed.
-- 3. Locks Entity: Existing 'locks' table from legacy schemas (using 'module' PK) is gracefully upgraded.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. MILESTONES (High-level architectural delivery increments)
CREATE TABLE IF NOT EXISTS public.milestones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    weight NUMERIC(5, 2) NOT NULL DEFAULT 1.00 CHECK (weight > 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'PLANNED', 'DEPRECATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SPECIALIZATIONS (Permanent domain categories)
CREATE TABLE IF NOT EXISTS public.specializations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    milestone TEXT NOT NULL DEFAULT 'M1' REFERENCES public.milestones(id) ON UPDATE CASCADE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DEPRECATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. AGENTS (Workers belonging to a specialization)
CREATE TABLE IF NOT EXISTS public.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_key TEXT NOT NULL UNIQUE,
    specialization_id UUID NOT NULL REFERENCES public.specializations(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'CLAIMING', 'WORKING', 'WAITING_BUILD', 'WAITING_AUDIT', 'BLOCKED', 'OFFLINE')),
    current_task_id UUID,
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TASKS (Lifecycle authority for temporary task branches)
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    specialization_id UUID NOT NULL REFERENCES public.specializations(id) ON DELETE RESTRICT,
    milestone TEXT NOT NULL DEFAULT 'M1' REFERENCES public.milestones(id) ON UPDATE CASCADE,
    priority INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
        'QUEUED', 'CLAIMED', 'IN_PROGRESS', 'WORKING', 'PR_OPEN',
        'BUILDING', 'BUILD_FAILED', 'TESTING', 'TEST_FAILED',
        'AUDITING', 'AUDIT_FAILED', 'READY_TO_MERGE', 'MERGING',
        'MERGED', 'POST_MERGE_VERIFY', 'CLEANUP', 'DONE', 'COMPLETED',
        'BLOCKED', 'FAILED', 'STALE', 'BACKLOG', 'CANCELLED'
    )),
    assigned_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    base_commit TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    pr_number INTEGER,
    current_commit_sha TEXT,
    merge_commit_sha TEXT,
    progress_weight NUMERIC(5, 2) NOT NULL DEFAULT 1.00 CHECK (progress_weight > 0),
    validation_level TEXT NOT NULL DEFAULT 'L1' CHECK (validation_level IN ('L0', 'L1', 'L2', 'L3')),
    acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    merged_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agents
    DROP CONSTRAINT IF EXISTS fk_agents_current_task;
ALTER TABLE public.agents
    ADD CONSTRAINT fk_agents_current_task FOREIGN KEY (current_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;

-- 4. TASK FILE OWNERSHIP (Exclusive / Shared file boundaries)
CREATE TABLE IF NOT EXISTS public.task_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    access_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (access_mode IN ('exclusive', 'shared-read')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, file_path)
);

-- 5. LOCKS (Resource locking per file/module/crate)
-- Conditional schema migration: Replace legacy locks table (PK 'module') if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'locks' AND column_name = 'module'
    ) THEN
        DROP TABLE IF EXISTS public.locks CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource TEXT NOT NULL UNIQUE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 6. BUILD JOBS (Laptop Build Worker records)
CREATE TABLE IF NOT EXISTS public.build_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    commit_sha TEXT NOT NULL,
    runner TEXT NOT NULL DEFAULT 'laptop-self-hosted',
    workflow_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    log_url TEXT
);

-- 7. TEST RESULTS (Level-based granular test outcomes)
CREATE TABLE IF NOT EXISTS public.test_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    build_job_id UUID REFERENCES public.build_jobs(id) ON DELETE SET NULL,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    commit_sha TEXT NOT NULL,
    suite TEXT NOT NULL,
    command TEXT NOT NULL,
    passed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
    log_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. AUDIT RESULTS (Architecture, contracts, security & quality checks)
CREATE TABLE IF NOT EXISTS public.audit_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    commit_sha TEXT NOT NULL,
    auditor TEXT NOT NULL DEFAULT 'antigravity-audit',
    status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'PASS_WITH_NOTES')),
    findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    severity TEXT NOT NULL DEFAULT 'NONE' CHECK (severity IN ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. EVENTS (Idempotent audit event bus)
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. TASK STATE TRANSITIONS (Complete immutable state transition audit log)
CREATE TABLE IF NOT EXISTS public.task_state_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('ARENA_AGENT', 'GITHUB_ACTION', 'BUILD_WORKER', 'AUDIT_WORKER', 'CLEANUP_WORKER', 'ANTIGRAVITY', 'SYSTEM')),
    actor_id TEXT NOT NULL,
    expected_version BIGINT NOT NULL,
    resulting_version BIGINT NOT NULL,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. PROGRESS SNAPSHOTS (Periodic and event-driven progress point-in-time state)
CREATE TABLE IF NOT EXISTS public.progress_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    main_commit_sha TEXT NOT NULL,
    project_progress NUMERIC(5, 2) NOT NULL CHECK (project_progress >= 0.0 AND project_progress <= 100.0),
    milestone_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
    done_count INTEGER NOT NULL DEFAULT 0,
    in_progress_count INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0,
    stale_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON public.tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_branch ON public.tasks(branch_name);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON public.tasks(milestone);
CREATE INDEX IF NOT EXISTS idx_agents_status ON public.agents(status);
CREATE INDEX IF NOT EXISTS idx_locks_expires ON public.locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_locks_resource ON public.locks(resource);
CREATE INDEX IF NOT EXISTS idx_test_results_task_commit ON public.test_results(task_id, commit_sha);
CREATE INDEX IF NOT EXISTS idx_audit_results_task_commit ON public.audit_results(task_id, commit_sha);
CREATE INDEX IF NOT EXISTS idx_transitions_task ON public.task_state_transitions(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_calculated_at ON public.progress_snapshots(calculated_at DESC);
-- ==============================================================================
-- ATOMIC STATE TRANSITION STORED PROCEDURES (RPCs)
-- ==============================================================================

-- RPC 1: CLAIM TASK
CREATE OR REPLACE FUNCTION public.claim_task(
    p_task_id UUID,
    p_agent_id UUID,
    p_expected_version BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_agent RECORD;
    v_new_version BIGINT;
    v_lock_conflict RECORD;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.status = 'CLAIMED' AND v_task.assigned_agent_id = p_agent_id THEN
        RETURN jsonb_build_object('success', true, 'action', 'IDEMPOTENT_RETURN', 'version', v_task.version);
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
    SET status = 'CLAIMED', assigned_agent_id = p_agent_id, claimed_at = NOW(), version = v_new_version, updated_at = NOW()
    WHERE id = p_task_id;

    UPDATE public.agents
    SET status = 'WORKING', current_task_id = p_task_id, version = v_agent.version + 1, updated_at = NOW()
    WHERE id = p_agent_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, 'QUEUED', 'CLAIMED', 'ARENA_AGENT', p_agent_id::text, p_expected_version, v_new_version, 'Task claimed successfully'
    );

    RETURN jsonb_build_object('success', true, 'status', 'CLAIMED', 'version', v_new_version);
END;
$$;

-- RPC 2: START TASK
CREATE OR REPLACE FUNCTION public.start_task(
    p_task_id UUID,
    p_agent_id UUID,
    p_expected_version BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.assigned_agent_id != p_agent_id THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_TASK_OWNER'); END IF;
    IF v_task.status = 'WORKING' THEN RETURN jsonb_build_object('success', true, 'action', 'ALREADY_WORKING', 'version', v_task.version); END IF;
    IF v_task.status != 'CLAIMED' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATE', 'current_status', v_task.status); END IF;
    IF v_task.version != p_expected_version THEN RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version); END IF;

    v_new_version := v_task.version + 1;
    UPDATE public.tasks SET status = 'WORKING', version = v_new_version, updated_at = NOW() WHERE id = p_task_id;
    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, 'CLAIMED', 'WORKING', 'ARENA_AGENT', p_agent_id::text, p_expected_version, v_new_version, 'Agent started work'
    );

    RETURN jsonb_build_object('success', true, 'status', 'WORKING', 'version', v_new_version);
END;
$$;

-- RPC 3: SUBMIT COMMIT
CREATE OR REPLACE FUNCTION public.submit_commit(
    p_task_id UUID,
    p_agent_id UUID,
    p_commit_sha TEXT,
    p_expected_version BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.assigned_agent_id != p_agent_id THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_TASK_OWNER'); END IF;
    IF v_task.status NOT IN ('WORKING', 'PR_OPEN', 'BUILD_FAILED', 'TEST_FAILED', 'AUDIT_FAILED') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATE', 'current_status', v_task.status);
    END IF;
    IF v_task.version != p_expected_version THEN RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version); END IF;

    v_new_version := v_task.version + 1;
    UPDATE public.tasks
    SET current_commit_sha = p_commit_sha, status = 'PR_OPEN', version = v_new_version, updated_at = NOW()
    WHERE id = p_task_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason, metadata
    ) VALUES (
        p_task_id, v_task.status, 'PR_OPEN', 'ARENA_AGENT', p_agent_id::text, p_expected_version, v_new_version, 'New commit submitted', jsonb_build_object('commit_sha', p_commit_sha)
    );

    RETURN jsonb_build_object('success', true, 'status', 'PR_OPEN', 'commit_sha', p_commit_sha, 'version', v_new_version);
END;
$$;

-- RPC 4: RECORD BUILD RESULT
CREATE OR REPLACE FUNCTION public.record_build_result(
    p_task_id UUID,
    p_commit_sha TEXT,
    p_workflow_run_id TEXT,
    p_status TEXT,
    p_log_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
    v_target_status TEXT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;

    -- Store historical build job record regardless of current SHA
    INSERT INTO public.build_jobs (task_id, commit_sha, runner, workflow_run_id, status, finished_at, log_url)
    VALUES (p_task_id, p_commit_sha, 'laptop-self-hosted', p_workflow_run_id, p_status, NOW(), p_log_url);

    -- Reject state progression if commit is stale
    IF v_task.current_commit_sha != p_commit_sha THEN
        RETURN jsonb_build_object('success', false, 'error', 'STALE_COMMIT', 'current_commit', v_task.current_commit_sha, 'reported_commit', p_commit_sha);
    END IF;

    v_target_status := CASE WHEN p_status = 'PASSED' THEN 'TESTING' ELSE 'BUILD_FAILED' END;
    v_new_version := v_task.version + 1;

    UPDATE public.tasks SET status = v_target_status, version = v_new_version, updated_at = NOW() WHERE id = p_task_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason, metadata
    ) VALUES (
        p_task_id, v_task.status, v_target_status, 'BUILD_WORKER', 'laptop-worker', v_task.version, v_new_version, 'Build finished with ' || p_status, jsonb_build_object('commit_sha', p_commit_sha, 'run_id', p_workflow_run_id)
    );

    RETURN jsonb_build_object('success', true, 'status', v_target_status, 'version', v_new_version);
END;
$$;

-- RPC 5: RECORD TEST RESULT
CREATE OR REPLACE FUNCTION public.record_test_result(
    p_task_id UUID,
    p_commit_sha TEXT,
    p_suite TEXT,
    p_command TEXT,
    p_passed INTEGER,
    p_failed INTEGER,
    p_skipped INTEGER,
    p_duration_ms INTEGER,
    p_status TEXT,
    p_log_ref TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
    v_target_status TEXT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;

    -- Store historical test result record regardless of current SHA
    INSERT INTO public.test_results (
        task_id, commit_sha, suite, command, passed, failed, skipped, duration_ms, status, log_reference
    ) VALUES (
        p_task_id, p_commit_sha, p_suite, p_command, p_passed, p_failed, p_skipped, p_duration_ms, p_status, p_log_ref
    );

    -- Reject state progression if commit is stale
    IF v_task.current_commit_sha != p_commit_sha THEN
        RETURN jsonb_build_object('success', false, 'error', 'STALE_COMMIT');
    END IF;

    IF p_status = 'FAILED' THEN v_target_status := 'TEST_FAILED'; ELSE v_target_status := 'AUDITING'; END IF;
    v_new_version := v_task.version + 1;

    UPDATE public.tasks SET status = v_target_status, version = v_new_version, updated_at = NOW() WHERE id = p_task_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, v_task.status, v_target_status, 'BUILD_WORKER', 'laptop-worker', v_task.version, v_new_version, 'Test suite ' || p_suite || ' reported ' || p_status
    );

    RETURN jsonb_build_object('success', true, 'status', v_target_status, 'version', v_new_version);
END;
$$;

-- RPC 6: RECORD AUDIT RESULT
CREATE OR REPLACE FUNCTION public.record_audit_result(
    p_task_id UUID,
    p_commit_sha TEXT,
    p_auditor TEXT,
    p_status TEXT,
    p_findings JSONB DEFAULT '[]'::jsonb,
    p_severity TEXT DEFAULT 'NONE'
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
    v_target_status TEXT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;

    -- Store historical audit record regardless of current SHA
    INSERT INTO public.audit_results (
        task_id, commit_sha, auditor, status, findings, severity
    ) VALUES (
        p_task_id, p_commit_sha, p_auditor, p_status, p_findings, p_severity
    );

    -- Reject state progression if commit is stale
    IF v_task.current_commit_sha != p_commit_sha THEN
        RETURN jsonb_build_object('success', false, 'error', 'STALE_COMMIT');
    END IF;

    IF p_status = 'FAIL' OR p_severity = 'CRITICAL' THEN v_target_status := 'AUDIT_FAILED'; ELSE v_target_status := 'READY_TO_MERGE'; END IF;
    v_new_version := v_task.version + 1;

    UPDATE public.tasks SET status = v_target_status, version = v_new_version, updated_at = NOW() WHERE id = p_task_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, v_task.status, v_target_status, 'AUDIT_WORKER', p_auditor, v_task.version, v_new_version, 'Audit completed: ' || p_status
    );

    RETURN jsonb_build_object('success', true, 'status', v_target_status, 'version', v_new_version);
END;
$$;
-- RPC 7: AUTHORIZE MERGE
CREATE OR REPLACE FUNCTION public.authorize_merge(
    p_task_id UUID,
    p_commit_sha TEXT,
    p_expected_version BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
    v_has_build_pass BOOLEAN;
    v_has_test_pass BOOLEAN;
    v_has_audit_pass BOOLEAN;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.status != 'READY_TO_MERGE' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATE', 'current_status', v_task.status); END IF;
    IF v_task.current_commit_sha != p_commit_sha THEN RETURN jsonb_build_object('success', false, 'error', 'STALE_COMMIT'); END IF;
    IF v_task.version != p_expected_version THEN RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version); END IF;

    SELECT EXISTS(SELECT 1 FROM public.build_jobs WHERE task_id = p_task_id AND commit_sha = p_commit_sha AND status = 'PASSED') INTO v_has_build_pass;
    SELECT EXISTS(SELECT 1 FROM public.test_results WHERE task_id = p_task_id AND commit_sha = p_commit_sha AND status = 'PASSED') INTO v_has_test_pass;
    SELECT EXISTS(SELECT 1 FROM public.audit_results WHERE task_id = p_task_id AND commit_sha = p_commit_sha AND status IN ('PASS', 'PASS_WITH_NOTES') AND severity != 'CRITICAL') INTO v_has_audit_pass;

    IF NOT (v_has_build_pass AND v_has_test_pass AND v_has_audit_pass) THEN
        RETURN jsonb_build_object('success', false, 'error', 'INCOMPLETE_VALIDATION', 'build_passed', v_has_build_pass, 'test_passed', v_has_test_pass, 'audit_passed', v_has_audit_pass);
    END IF;

    v_new_version := v_task.version + 1;
    UPDATE public.tasks SET status = 'MERGING', version = v_new_version, updated_at = NOW() WHERE id = p_task_id;
    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, 'READY_TO_MERGE', 'MERGING', 'ANTIGRAVITY', 'orchestrator', p_expected_version, v_new_version, 'All validations satisfied for commit ' || p_commit_sha
    );

    RETURN jsonb_build_object('success', true, 'status', 'MERGING', 'version', v_new_version);
END;
$$;

-- RPC 8: RECORD MERGE
CREATE OR REPLACE FUNCTION public.record_merge(
    p_task_id UUID,
    p_merge_commit_sha TEXT,
    p_expected_version BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.status IN ('MERGED', 'POST_MERGE_VERIFY') THEN
        RETURN jsonb_build_object('success', true, 'action', 'ALREADY_MERGED', 'status', v_task.status, 'version', v_task.version);
    END IF;
    IF v_task.status != 'MERGING' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATE', 'current_status', v_task.status); END IF;
    IF v_task.version != p_expected_version THEN RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version); END IF;

    v_new_version := v_task.version + 1;
    UPDATE public.tasks SET status = 'POST_MERGE_VERIFY', merge_commit_sha = p_merge_commit_sha, merged_at = NOW(), version = v_new_version, updated_at = NOW() WHERE id = p_task_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason, metadata
    ) VALUES (
        p_task_id, 'MERGING', 'POST_MERGE_VERIFY', 'GITHUB_ACTION', 'merge_hook', p_expected_version, v_new_version, 'PR merged into main', jsonb_build_object('merge_sha', p_merge_commit_sha)
    );

    RETURN jsonb_build_object('success', true, 'status', 'POST_MERGE_VERIFY', 'version', v_new_version);
END;
$$;

-- RPC 9: START CLEANUP
CREATE OR REPLACE FUNCTION public.start_cleanup(
    p_task_id UUID,
    p_expected_version BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.status = 'CLEANUP' THEN RETURN jsonb_build_object('success', false, 'error', 'ALREADY_IN_CLEANUP'); END IF;
    IF v_task.status = 'COMPLETED' THEN RETURN jsonb_build_object('success', true, 'action', 'ALREADY_COMPLETED', 'status', 'COMPLETED'); END IF;
    IF v_task.status != 'POST_MERGE_VERIFY' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATE', 'current_status', v_task.status); END IF;
    IF v_task.version != p_expected_version THEN RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version); END IF;

    v_new_version := v_task.version + 1;
    UPDATE public.tasks SET status = 'CLEANUP', version = v_new_version, updated_at = NOW() WHERE id = p_task_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, 'POST_MERGE_VERIFY', 'CLEANUP', 'CLEANUP_WORKER', 'cleanup_runner', p_expected_version, v_new_version, 'Started cleanup'
    );

    RETURN jsonb_build_object('success', true, 'status', 'CLEANUP', 'version', v_new_version);
END;
$$;

-- RPC 10: COMPLETE CLEANUP
CREATE OR REPLACE FUNCTION public.complete_cleanup(
    p_task_id UUID,
    p_expected_version BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_task RECORD;
    v_new_version BIGINT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND'); END IF;
    IF v_task.status IN ('DONE', 'COMPLETED') THEN RETURN jsonb_build_object('success', true, 'action', 'ALREADY_COMPLETED', 'status', 'DONE'); END IF;
    IF v_task.status != 'CLEANUP' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATE', 'current_status', v_task.status); END IF;
    IF v_task.version != p_expected_version THEN RETURN jsonb_build_object('success', false, 'error', 'VERSION_CONFLICT', 'current_version', v_task.version); END IF;

    DELETE FROM public.locks WHERE task_id = p_task_id;
    IF v_task.assigned_agent_id IS NOT NULL THEN
        UPDATE public.agents SET status = 'AVAILABLE', current_task_id = NULL, version = version + 1, updated_at = NOW() WHERE id = v_task.assigned_agent_id;
    END IF;

    v_new_version := v_task.version + 1;
    UPDATE public.tasks SET status = 'DONE', completed_at = NOW(), version = v_new_version, updated_at = NOW() WHERE id = p_task_id;

    INSERT INTO public.task_state_transitions (
        task_id, from_status, to_status, actor_type, actor_id, expected_version, resulting_version, reason
    ) VALUES (
        p_task_id, 'CLEANUP', 'DONE', 'CLEANUP_WORKER', 'cleanup_runner', p_expected_version, v_new_version, 'Cleanup completed, task verified DONE'
    );

    RETURN jsonb_build_object('success', true, 'status', 'DONE', 'version', v_new_version);
END;
$$;

-- RPC 11: ACQUIRE FILE LOCK
CREATE OR REPLACE FUNCTION public.acquire_file_lock(
    p_resource TEXT,
    p_task_id UUID,
    p_agent_id UUID,
    p_ttl_seconds INTEGER DEFAULT 3600
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_expires_at TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
    v_current_lock RECORD;
BEGIN
    SELECT * INTO v_current_lock FROM public.locks WHERE resource = p_resource FOR UPDATE;
    IF FOUND THEN
        IF v_current_lock.expires_at > v_now AND v_current_lock.task_id != p_task_id THEN
            RETURN jsonb_build_object('acquired', false, 'error', 'LOCK_DENIED', 'owner_task_id', v_current_lock.task_id, 'expires_at', v_current_lock.expires_at);
        END IF;

        UPDATE public.locks SET task_id = p_task_id, agent_id = p_agent_id, acquired_at = v_now, expires_at = v_expires_at WHERE resource = p_resource;
        RETURN jsonb_build_object('acquired', true, 'action', 'RENEWED', 'expires_at', v_expires_at);
    ELSE
        INSERT INTO public.locks (resource, task_id, agent_id, acquired_at, expires_at)
        VALUES (p_resource, p_task_id, p_agent_id, v_now, v_expires_at);
        RETURN jsonb_build_object('acquired', true, 'action', 'ACQUIRED', 'expires_at', v_expires_at);
    END IF;
END;
$$;

-- RPC 12: RELEASE FILE LOCK
CREATE OR REPLACE FUNCTION public.release_file_lock(
    p_resource TEXT,
    p_task_id UUID,
    p_agent_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_lock RECORD;
BEGIN
    SELECT * INTO v_current_lock FROM public.locks WHERE resource = p_resource FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('released', true, 'status', 'NOT_FOUND'); END IF;
    IF v_current_lock.task_id != p_task_id THEN RETURN jsonb_build_object('released', false, 'error', 'UNAUTHORIZED_TASK_MISMATCH'); END IF;

    DELETE FROM public.locks WHERE resource = p_resource;
    RETURN jsonb_build_object('released', true, 'status', 'RELEASED');
END;
$$;

-- RPC 13: REAP EXPIRED LEASES
CREATE OR REPLACE FUNCTION public.reap_expired_leases()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_reaped_locks INTEGER := 0;
    v_reaped_agents INTEGER := 0;
BEGIN
    WITH deleted_locks AS (
        DELETE FROM public.locks WHERE expires_at < v_now RETURNING resource
    )
    SELECT COUNT(*) INTO v_reaped_locks FROM deleted_locks;

    WITH offline_agents AS (
        UPDATE public.agents
        SET status = 'OFFLINE', version = version + 1, updated_at = v_now
        WHERE last_heartbeat < (v_now - INTERVAL '10 minutes')
          AND status IN ('AVAILABLE', 'WORKING', 'WAITING_BUILD', 'WAITING_AUDIT', 'CLAIMING')
        RETURNING id
    )
    SELECT COUNT(*) INTO v_reaped_agents FROM offline_agents;

    RETURN jsonb_build_object('success', true, 'reaped_locks_count', v_reaped_locks, 'offline_agents_count', v_reaped_agents, 'timestamp', v_now);
END;
$$;

-- ==============================================================================
-- PROGRESS ENGINE STORED PROCEDURES (RPCs)
-- ==============================================================================

-- RPC 14: GET PROJECT PROGRESS
CREATE OR REPLACE FUNCTION public.get_project_progress()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_total_weight NUMERIC(10, 2) := 0;
    v_done_weight NUMERIC(10, 2) := 0;
    v_project_progress NUMERIC(5, 2) := 0.0;
    v_done_count INTEGER := 0;
    v_in_progress_count INTEGER := 0;
    v_queued_count INTEGER := 0;
    v_blocked_count INTEGER := 0;
    v_stale_count INTEGER := 0;
    v_milestones JSONB := '[]'::jsonb;
    v_tasks JSONB := '[]'::jsonb;
BEGIN
    SELECT 
        COALESCE(SUM(progress_weight), 0),
        COALESCE(SUM(CASE WHEN status = 'DONE' THEN progress_weight ELSE 0 END), 0),
        COUNT(CASE WHEN status = 'DONE' THEN 1 END),
        COUNT(CASE WHEN status IN ('IN_PROGRESS', 'WORKING', 'CLAIMED', 'READY_TO_MERGE', 'MERGED', 'POST_MERGE_VERIFY') THEN 1 END),
        COUNT(CASE WHEN status IN ('QUEUED', 'BACKLOG') THEN 1 END),
        COUNT(CASE WHEN status = 'BLOCKED' THEN 1 END),
        COUNT(CASE WHEN status = 'STALE' THEN 1 END)
    INTO 
        v_total_weight, v_done_weight,
        v_done_count, v_in_progress_count, v_queued_count, v_blocked_count, v_stale_count
    FROM public.tasks
    WHERE deleted_at IS NULL;

    IF v_total_weight > 0 THEN
        v_project_progress := ROUND((v_done_weight / v_total_weight) * 100.0, 2);
    ELSE
        v_project_progress := 0.0;
    END IF;

    SELECT COALESCE(jsonb_agg(m_agg), '[]'::jsonb) INTO v_milestones
    FROM (
        SELECT 
            m.id AS milestone,
            m.name,
            m.weight AS milestone_weight,
            COALESCE(SUM(t.progress_weight), 0) AS total_weight,
            COALESCE(SUM(CASE WHEN t.status = 'DONE' THEN t.progress_weight ELSE 0 END), 0) AS completed_weight,
            CASE 
                WHEN COALESCE(SUM(t.progress_weight), 0) > 0 
                THEN ROUND((COALESCE(SUM(CASE WHEN t.status = 'DONE' THEN t.progress_weight ELSE 0 END), 0) / SUM(t.progress_weight)) * 100.0, 2)
                ELSE 0.0
            END AS progress,
            jsonb_build_object(
                'done', COUNT(CASE WHEN t.status = 'DONE' THEN 1 END),
                'in_progress', COUNT(CASE WHEN t.status IN ('IN_PROGRESS', 'WORKING', 'CLAIMED', 'READY_TO_MERGE', 'MERGED', 'POST_MERGE_VERIFY') THEN 1 END),
                'queued', COUNT(CASE WHEN t.status IN ('QUEUED', 'BACKLOG') THEN 1 END),
                'blocked', COUNT(CASE WHEN t.status = 'BLOCKED' THEN 1 END),
                'stale', COUNT(CASE WHEN t.status = 'STALE' THEN 1 END)
            ) AS task_counts
        FROM public.milestones m
        LEFT JOIN public.tasks t ON t.milestone = m.id AND t.deleted_at IS NULL
        GROUP BY m.id, m.name, m.weight
        ORDER BY m.id
    ) m_agg;

    SELECT COALESCE(jsonb_agg(t_item), '[]'::jsonb) INTO v_tasks
    FROM (
        SELECT 
            t.task_key,
            t.milestone,
            t.status,
            t.progress_weight,
            CASE WHEN t.status = 'DONE' THEN 100.0 ELSE 0.0 END AS progress,
            t.current_commit_sha AS evidence_commit_sha,
            s.slug AS specialization
        FROM public.tasks t
        JOIN public.specializations s ON t.specialization_id = s.id
        WHERE t.deleted_at IS NULL
        ORDER BY t.milestone, t.task_key
    ) t_item;

    RETURN jsonb_build_object(
        'project_progress', v_project_progress,
        'total_weight', v_total_weight,
        'completed_weight', v_done_weight,
        'done_count', v_done_count,
        'in_progress_count', v_in_progress_count,
        'queued_count', v_queued_count,
        'blocked_count', v_blocked_count,
        'stale_count', v_stale_count,
        'milestones', v_milestones,
        'tasks', v_tasks
    );
END;
$$;

-- RPC 15: GET MILESTONE PROGRESS
CREATE OR REPLACE FUNCTION public.get_milestone_progress(p_milestone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'milestone', p_milestone,
        'total_weight', COALESCE(SUM(t.progress_weight), 0),
        'completed_weight', COALESCE(SUM(CASE WHEN t.status = 'DONE' THEN t.progress_weight ELSE 0 END), 0),
        'progress', CASE 
            WHEN COALESCE(SUM(t.progress_weight), 0) > 0 
            THEN ROUND((COALESCE(SUM(CASE WHEN t.status = 'DONE' THEN t.progress_weight ELSE 0 END), 0) / SUM(t.progress_weight)) * 100.0, 2)
            ELSE 0.0
        END,
        'task_counts', jsonb_build_object(
            'done', COUNT(CASE WHEN t.status = 'DONE' THEN 1 END),
            'in_progress', COUNT(CASE WHEN t.status IN ('IN_PROGRESS', 'WORKING', 'CLAIMED', 'READY_TO_MERGE', 'MERGED', 'POST_MERGE_VERIFY') THEN 1 END),
            'queued', COUNT(CASE WHEN t.status IN ('QUEUED', 'BACKLOG') THEN 1 END),
            'blocked', COUNT(CASE WHEN t.status = 'BLOCKED' THEN 1 END),
            'stale', COUNT(CASE WHEN t.status = 'STALE' THEN 1 END)
        )
    ) INTO v_result
    FROM public.tasks t
    WHERE t.milestone = p_milestone AND t.deleted_at IS NULL;

    RETURN v_result;
END;
$$;

-- RPC 16: GET TASK PROGRESS
CREATE OR REPLACE FUNCTION public.get_task_progress(p_task_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_task RECORD;
BEGIN
    SELECT t.*, s.slug as specialization_slug
    INTO v_task
    FROM public.tasks t
    JOIN public.specializations s ON t.specialization_id = s.id
    WHERE t.task_key = p_task_key AND t.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'TASK_NOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'task_key', v_task.task_key,
        'specialization', v_task.specialization_slug,
        'milestone', v_task.milestone,
        'status', v_task.status,
        'progress_weight', v_task.progress_weight,
        'progress', CASE WHEN v_task.status = 'DONE' THEN 100.0 ELSE 0.0 END,
        'validation_level', v_task.validation_level,
        'current_commit_sha', v_task.current_commit_sha,
        'acceptance_criteria', v_task.acceptance_criteria,
        'timestamps', jsonb_build_object(
            'created_at', v_task.created_at,
            'claimed_at', v_task.claimed_at,
            'completed_at', v_task.completed_at,
            'updated_at', v_task.updated_at
        )
    );
END;
$$;

-- RPC 17: RECORD PROGRESS SNAPSHOT
CREATE OR REPLACE FUNCTION public.record_progress_snapshot(
    p_main_commit_sha TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_proj JSONB;
    v_snapshot_id UUID := gen_random_uuid();
    v_now TIMESTAMPTZ := NOW();
BEGIN
    v_proj := public.get_project_progress();

    INSERT INTO public.progress_snapshots (
        id, calculated_at, main_commit_sha, project_progress,
        milestone_progress, done_count, in_progress_count,
        queued_count, blocked_count, stale_count, metadata, created_at
    ) VALUES (
        v_snapshot_id, v_now, p_main_commit_sha,
        (v_proj->>'project_progress')::NUMERIC,
        v_proj->'milestones',
        (v_proj->>'done_count')::INTEGER,
        (v_proj->>'in_progress_count')::INTEGER,
        (v_proj->>'queued_count')::INTEGER,
        (v_proj->>'blocked_count')::INTEGER,
        (v_proj->>'stale_count')::INTEGER,
        p_metadata, v_now
    );

    INSERT INTO public.events (
        event_id, event_type, source, payload, processed_at, created_at
    ) VALUES (
        'evt-snapshot-' || v_snapshot_id, 'PROGRESS_UPDATED', 'PROGRESS_ENGINE',
        jsonb_build_object(
            'snapshot_id', v_snapshot_id,
            'project_progress', v_proj->>'project_progress',
            'main_commit_sha', p_main_commit_sha
        ),
        v_now, v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'snapshot_id', v_snapshot_id,
        'project_progress', v_proj->>'project_progress',
        'calculated_at', v_now
    );
END;
$$;

-- RPC 18: GET LATEST PROGRESS SNAPSHOT
CREATE OR REPLACE FUNCTION public.get_latest_progress_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_row RECORD;
BEGIN
    SELECT * INTO v_row
    FROM public.progress_snapshots
    ORDER BY calculated_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_SNAPSHOT_FOUND');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'snapshot_id', v_row.id,
        'calculated_at', v_row.calculated_at,
        'main_commit_sha', v_row.main_commit_sha,
        'project_progress', v_row.project_progress,
        'milestone_progress', v_row.milestone_progress,
        'done_count', v_row.done_count,
        'in_progress_count', v_row.in_progress_count,
        'queued_count', v_row.queued_count,
        'blocked_count', v_row.blocked_count,
        'stale_count', v_row.stale_count,
        'metadata', v_row.metadata
    );
END;
$$;

-- SEED 10 MILESTONES
INSERT INTO public.milestones (id, name, description, weight)
VALUES
    ('M1', 'Runtime Kernel', 'Core runtime execution frames, DAG runner, memory governor', 1.00),
    ('M2', 'Execution Engine', 'Task scheduler, lifecycle coordination, flow dispatch', 1.00),
    ('M3', 'Data Plane', 'ItemBuffer, zero-copy payload streaming, memory limits', 1.00),
    ('M4', 'Memory', 'Heap budget manager, spill-to-disk, backpressure', 1.00),
    ('M5', 'Node System', 'Node trait adapters, native node implementations', 1.00),
    ('M6', 'Workflow Model', 'Workflow graph model, connections lowering, validation', 1.00),
    ('M7', 'Expression Engine', 'Sandboxed expression evaluator, AST parser, JS compat', 1.00),
    ('M8', 'Validation', 'DAG integrity checks, cycle detection, structure bounds', 1.00),
    ('M9', 'Integration', 'Cross-crate conformance tests, golden replay suite', 1.00),
    ('M10', 'Security', 'Execution sandbox, memory boundary protection, security policies', 1.00)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    weight = EXCLUDED.weight,
    updated_at = NOW();

-- SEED 10 FROZEN SPECIALIZATIONS
INSERT INTO public.specializations (slug, name, description, milestone)
VALUES
    ('runtime-kernel', 'Runtime Kernel', 'Core runtime architecture, WorkflowRunner, execution frames, memory governor', 'M1'),
    ('execution-engine', 'Execution Engine', 'State machine, scheduler, lifecycle coordination, flow dispatch', 'M2'),
    ('data-plane', 'Data Plane', 'Minimal-copy ItemBuffer, DataRecord, binary streaming, zero-GC buffers', 'M3'),
    ('memory', 'Memory Management', 'Memory budget, spill-to-disk, backpressure, atomic heap governor', 'M4'),
    ('node-system', 'Node System', 'Node parameter forms, trait adapters, native node implementations', 'M5'),
    ('workflow-model', 'Workflow Model', 'Workflow JSON deserialization, connections graph, node metadata', 'M6'),
    ('expression-engine', 'Expression Engine', 'AST parser, sandboxed evaluator, JavaScript syntax compatibility', 'M7'),
    ('validation', 'Validation & Integrity', 'DAG cycle detection, uniqueness, dangling connection validation', 'M8'),
    ('integration', 'Integration & Conformance', 'Cross-crate conformance tests, golden replay, reference parity', 'M9'),
    ('security', 'Security & Sandbox', 'Prototype pollution guard, memory isolation, execution policies', 'M10')
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    milestone = EXCLUDED.milestone,
    updated_at = NOW();

-- RLS LOCKDOWN
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.build_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, public;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, public;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;