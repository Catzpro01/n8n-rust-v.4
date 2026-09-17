// Node Parameter Issues & Validation Engine (Phase 3C)
//
// Phase 4C: pesan validasi tidak lagi di-hardcode dalam satu bahasa — kini
// dirender melalui NativeLocalizationService (kunci `param.*`, 6 bahasa).
// Locale default tetap 'id', sehingga keluaran bawaan identik dengan Phase 3C.

import { NativeLocalizationService } from './backend-localization-service';

export interface ParameterIssue {
  parameter: string;
  message: string;
  issueType: 'missing' | 'invalid_type' | 'out_of_bounds' | 'custom';
}

export interface NodeParameterDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'options' | 'collection' | 'json';
  required?: boolean;
  default?: unknown;
  typeOptions?: {
    minValue?: number;
    maxValue?: number;
  };
}

export class NodeParameterValidator {
  public static validateField(
    paramDef: NodeParameterDefinition,
    val: unknown
  ): ParameterIssue | null {
    if (paramDef.required && (val === undefined || val === null || val === '')) {
      return {
        parameter: paramDef.name,
        message: NativeLocalizationService.translate('param.required', undefined, {
          name: paramDef.name,
        }),
        issueType: 'missing',
      };
    }

    if (val !== undefined && val !== null && val !== '') {
      if (paramDef.type === 'number') {
        const num = Number(val);
        if (isNaN(num)) {
          return {
            parameter: paramDef.name,
            message: NativeLocalizationService.translate('param.invalid_number', undefined, {
              value: String(val),
            }),
            issueType: 'invalid_type',
          };
        }
        if (paramDef.typeOptions?.minValue !== undefined && num < paramDef.typeOptions.minValue) {
          return {
            parameter: paramDef.name,
            message: NativeLocalizationService.translate('param.below_min', undefined, {
              value: num,
              min: paramDef.typeOptions.minValue,
            }),
            issueType: 'out_of_bounds',
          };
        }
        if (paramDef.typeOptions?.maxValue !== undefined && num > paramDef.typeOptions.maxValue) {
          return {
            parameter: paramDef.name,
            message: NativeLocalizationService.translate('param.above_max', undefined, {
              value: num,
              max: paramDef.typeOptions.maxValue,
            }),
            issueType: 'out_of_bounds',
          };
        }
      }
    }

    return null;
  }

  public static getNodeParametersIssues(
    definitions: NodeParameterDefinition[],
    parameters: Record<string, unknown>
  ): ParameterIssue[] {
    const issues: ParameterIssue[] = [];
    for (const def of definitions) {
      const val = parameters[def.name];
      const issue = this.validateField(def, val);
      if (issue) issues.push(issue);
    }
    return issues;
  }
}
