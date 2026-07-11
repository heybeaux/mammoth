import type {
  EntailmentVerification,
  RuntimeBudgetAmount,
  RuntimeCharter,
  RuntimeResult,
} from '@mammoth/runtime';

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface RunRequest {
  root: string;
  charter: RuntimeCharter;
  verifications: Readonly<Record<string, EntailmentVerification>>;
  sourceFixture?: { path: string; digest: string; mediaType: string };
  retrievalUsage?: {
    estimated: RuntimeBudgetAmount;
    actual: RuntimeBudgetAmount;
  };
  maxSteps?: number;
}

export type OperatorRunOutcome =
  | RuntimeResult
  | {
      programId: string;
      executionId: string;
      status: 'paused';
      publicationStatus: 'partial';
      completedStages: string[];
    };

export interface RuntimeFactory {
  run(request: RunRequest): Promise<OperatorRunOutcome>;
}

export interface CliDependencies {
  io: CliIo;
  runtime: RuntimeFactory;
  cwd(): string;
}

export type CliCommand =
  | {
      name: 'run';
      charterPath: string;
      root: string;
      json: boolean;
      maxSteps?: number;
    }
  | {
      name: 'status' | 'resume' | 'cancel' | 'inspect';
      programId: string;
      root: string;
      json: boolean;
      maxSteps?: number;
    };

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
