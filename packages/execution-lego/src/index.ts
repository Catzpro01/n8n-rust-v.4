/**
 * @lego/execution — EXECUTION (runtime) LEGO entry point.
 *
 * Boundary: this package may only depend on the published ports above
 * (see `./model-surface.ts`) and on `@lego/reconstructed-engine`'s execution engine.
 * Rust: NOT STARTED — ZERO RUST per PROJECT_RULES.md §1.
 */

export {
	EXECUTION_REFERENCE,
	ARTIFICIAL_TASK_DATA,
	WORKFLOW_AUTODEACTIVATION_DEFAULTS,
	PUSH_AFTER_UI_TIMEOUT_MS,
	UnexpectedError,
	OperationalError,
	UserError,
	ApplicationError,
	ExecutionNotFoundError,
	ExecutionAlreadyResumingError,
	ExecutionCancelledError,
	ManualExecutionCancelledError,
	TimeoutExecutionCancelledError,
	SystemShutdownExecutionCancelledError,
	TriggerCloseError,
	WorkflowActivationError,
	WorkflowDeactivationError,
	NodeCrashedError,
	WorkflowCrashedError,
	ActiveExecutions,
	ActiveWorkflows,
	ExecutionContextHookRegistry,
	ExecutionContextService,
	ExecutionRecoveryService,
	MemoryExecutionRepository,
	MemoryExecutionPersistence,
	MemoryWorkflowRepository,
	MemoryConcurrencyControl,
	Emitter,
	noopLogger,
	createRecordingLogger,
	createDeferred,
	deepMerge,
	isWorkflowIdValid,
	createExecutionRuntime,
} from '../../reconstructed-engine/src/execution-engine.ts';
