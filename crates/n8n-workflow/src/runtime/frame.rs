use crate::runtime::context::MemoryBudget;
use crate::runtime::error::ExecutionError;
use crate::runtime::ir::NodeIndex;
use n8n_execution_data::{DataRecord, ItemBuffer};
use std::sync::Arc;

/// Dynamic execution frame passed to a node during execution with memory governor integration
pub struct ExecutionFrame<'a> {
    pub node_idx: NodeIndex,
    pub inputs: &'a [ItemBuffer],
    pub outputs: Vec<ItemBuffer>,
    pub item_cursor: usize,
    pub iteration_idx: u32,
    pub memory_budget: Option<Arc<MemoryBudget>>,
}

impl<'a> ExecutionFrame<'a> {
    pub fn new(node_idx: NodeIndex, inputs: &'a [ItemBuffer], output_port_count: usize) -> Self {
        let mut outputs = Vec::with_capacity(output_port_count);
        for _ in 0..output_port_count {
            outputs.push(ItemBuffer::new());
        }
        Self {
            node_idx,
            inputs,
            outputs,
            item_cursor: 0,
            iteration_idx: 0,
            memory_budget: None,
        }
    }

    pub fn with_memory_budget(mut self, budget: Arc<MemoryBudget>) -> Self {
        self.memory_budget = Some(budget);
        self
    }

    pub fn input(&self, port: usize) -> Option<&ItemBuffer> {
        self.inputs.get(port)
    }

    pub fn main_input(&self) -> Option<&ItemBuffer> {
        self.input(0)
    }

    /// P0-8 Fix: Enforces actual memory allocation check on push against MemoryBudget
    pub fn push_output(&mut self, port: usize, record: DataRecord) -> Result<(), ExecutionError> {
        if let Some(ref budget) = self.memory_budget {
            budget.allocate(record.estimated_bytes())?;
        }

        if port >= self.outputs.len() {
            self.outputs.resize_with(port + 1, ItemBuffer::new);
        }
        self.outputs[port].push(record);
        Ok(())
    }

    pub fn set_output(&mut self, port: usize, buffer: ItemBuffer) -> Result<(), ExecutionError> {
        if let Some(ref budget) = self.memory_budget {
            budget.allocate(buffer.estimated_bytes())?;
        }

        if port >= self.outputs.len() {
            self.outputs.resize_with(port + 1, ItemBuffer::new);
        }
        self.outputs[port] = buffer;
        Ok(())
    }

    pub fn take_outputs(self) -> Vec<ItemBuffer> {
        self.outputs
    }
}
