export const CLI_RESPONSE_CONTRACT = 'sdoc.cli.response/1' as const;

export type CliFailureCategory = 'argument' | 'document' | 'conflict' | 'io' | 'internal';

export interface OutputRecord {
  ok: boolean;
  command?: string;
  path?: string;
  preview?: boolean;
  written?: boolean;
  category?: CliFailureCategory;
  [key: string]: unknown;
}

export function withResponseContract(value: OutputRecord): OutputRecord {
  return { ...value, contract: CLI_RESPONSE_CONTRACT };
}

export function failureRecord(
  category: CliFailureCategory,
  code: string,
  message: string,
): OutputRecord {
  return {
    ok: false,
    category,
    diagnostics: [{ code, message }],
  };
}
