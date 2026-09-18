use crate::runtime::context::ExecutionContext;
use crate::runtime::error::ExecutionError;
use crate::runtime::frame::ExecutionFrame;
use async_trait::async_trait;
use n8n_node_model::NodeTypeDescription;

#[async_trait]
pub trait NodeExecutor: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> NodeTypeDescription;
    async fn execute<'a>(
        &self,
        ctx: &'a ExecutionContext,
        frame: &'a mut ExecutionFrame<'a>,
    ) -> Result<(), ExecutionError>;
}
