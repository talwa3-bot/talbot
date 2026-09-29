export type ErrorCode =
  | "UNAUTHORIZED_SCOPE" | "AMBIGUOUS_PERIOD" | "UNRECONCILED_SOURCE"
  | "MISSING_FX_RATE" | "STALE_SNAPSHOT" | "INVALID_AMOUNT" | "MIXED_CURRENCY" | "UNSUPPORTED_QUERY"
  | "INCOMPLETE_DATA" | "INVALID_STATE" | "NOT_FOUND" | "VALIDATION_FAILED" | "UNAUTHENTICATED";

export class LedgerError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
  }
}
