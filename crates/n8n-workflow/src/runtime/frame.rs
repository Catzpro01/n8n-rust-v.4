use crate::runtime::ir::NodeIndex;
use n8n_execution_data::{DataRecord, ItemBuffer};

/// Dynamic execution frame passed to a node during execution
pub struct ExecutionFrame<'a> {
    pub node_idx: NodeIndex,
    pub inputs: &'a [ItemBuffer],
    pub outputs: Vec<ItemBuffer>,
    pub item_cursor: usize,
    pub iteration_idx: u32,
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
        }
    }

    pub fn input(&self, port: usize) -> Option<&ItemBuffer> {
        self.inputs.get(port)
    }

    pub fn main_input(&self) -> Option<&ItemBuffer> {
        self.input(0)
    }

    pub fn push_output(&mut self, port: usize, record: DataRecord) {
        if port >= self.outputs.len() {
            self.outputs.resize_with(port + 1, ItemBuffer::new);
        }
        self.outputs[port].push(record);
    }

    pub fn set_output(&mut self, port: usize, buffer: ItemBuffer) {
        if port >= self.outputs.len() {
            self.outputs.resize_with(port + 1, ItemBuffer::new);
        }
        self.outputs[port] = buffer;
    }

    pub fn take_outputs(self) -> Vec<ItemBuffer> {
        self.outputs
    }
}
