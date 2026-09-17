// Schema Persistence Guard — Konsolidasi Error Handling & Schema Persistence
// 1:1 dari @n8n/db & workflow validation

export interface SchemaGuardResult {
  valid: boolean;
  errors: string[];
}

export class SchemaPersistenceGuard {
  static validateWorkflowSchema(workflow: any): SchemaGuardResult {
    const errors: string[] = [];

    if (!workflow) {
      errors.push('Workflow is null or undefined');
      return { valid: false, errors };
    }

    if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
      errors.push('Workflow nodes must be an array');
    }

    if (!workflow.connections || typeof workflow.connections !== 'object') {
      errors.push('Workflow connections must be an object');
    }

    if (workflow.nodes) {
      const names = new Set<string>();
      for (const node of workflow.nodes) {
        if (!node.name) errors.push('Node missing name');
        if (!node.type) errors.push(`Node ${node.name} missing type`);
        if (names.has(node.name)) errors.push(`Duplicate node name: ${node.name}`);
        names.add(node.name);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static sanitizeForPersistence(workflow: any): any {
    // Hapus field volatile sebelum simpan ke DB
    const sanitized = JSON.parse(JSON.stringify(workflow));
    delete sanitized.active;
    if (sanitized.nodes) {
      for (const node of sanitized.nodes) {
        delete node.executeOnce;
      }
    }
    return sanitized;
  }
}
