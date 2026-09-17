/**
 * Credentials LEGO — Reconstructed 1:1 from n8n v2.9.4
 * Source: reference/n8n/packages/core/src/credentials.ts, packages/cli/src/credentials/
 */

export interface ICredentialType {
  name: string;
  displayName: string;
  properties: any[];
  authenticate?: any;
  test?: any;
}

export interface ICredentials {
  id: string;
  name: string;
  type: string;
  data: Record<string, any>;
}

export class CredentialsHelper {
  private credentialTypes: Map<string, ICredentialType> = new Map();

  registerCredentialType(type: ICredentialType): void {
    this.credentialTypes.set(type.name, type);
  }

  getCredentialType(name: string): ICredentialType | undefined {
    return this.credentialTypes.get(name);
  }

  async authenticate(credential: ICredentials, requestOptions: any): Promise<any> {
    const type = this.getCredentialType(credential.type);
    if (!type?.authenticate) return requestOptions;

    const auth = type.authenticate;
    if (auth.type === 'generic') {
      const properties = auth.properties;
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'string' && value.startsWith('=')) {
          const propName = value.slice(2);
          requestOptions[key] = credential.data[propName];
        } else {
          requestOptions[key] = value;
        }
      }
    }

    return requestOptions;
  }

  sanitizeCredentialData(data: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length > 0) {
        sanitized[key] = '***';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  validateCredentialData(typeName: string, data: Record<string, any>): { valid: boolean; errors: string[] } {
    const type = this.getCredentialType(typeName);
    if (!type) {
      return { valid: false, errors: [`Unknown credential type: ${typeName}`] };
    }

    const errors: string[] = [];
    for (const prop of type.properties) {
      if (prop.required && !data[prop.name]) {
        errors.push(`Missing required field: ${prop.name}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export function isCredentialUsedInWorkflow(workflow: any, credentialId: string): boolean {
  for (const node of workflow.nodes || []) {
    if (node.credentials) {
      for (const cred of Object.values(node.credentials) as any[]) {
        if (cred.id === credentialId) return true;
      }
    }
  }
  return false;
}
