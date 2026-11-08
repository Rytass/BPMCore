import type { ExpressionErrorCode } from './expression-errors';

/**
 * A failure an engine adapter has already classified. Adapters for engines
 * that report a machine-readable code (cel-v2) throw this instead of the
 * engine's own error, so `toExpressionRuntimeError` never reads engine text.
 *
 * `keyNameCandidate` is only a candidate: it is shown nowhere until
 * `toExpressionRuntimeError` has checked that the author wrote it.
 * The message is fixed so nothing reaches a log by accident.
 */
export class ExpressionEngineFailure extends Error {
  readonly code: ExpressionErrorCode;
  readonly keyNameCandidate: string | null;

  constructor(
    code: ExpressionErrorCode,
    keyNameCandidate: string | null = null,
  ) {
    super(code);

    this.name = 'ExpressionEngineFailure';
    this.code = code;
    this.keyNameCandidate = keyNameCandidate;
  }
}
