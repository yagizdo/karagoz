// The closed set of error codes (K5). Anything thrown without one surfaces as INTERNAL.
export type ErrorCode =
  | 'NO_COMMAND'
  | 'UNKNOWN_COMMAND'
  | 'INVALID_ARGS'
  | 'ADB_NOT_FOUND'
  | 'ADB_TIMEOUT'
  | 'ADB_FAILED'
  | 'NO_DEVICE'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_AMBIGUOUS'
  | 'DEVICE_NOT_READY'
  | 'CAPTURE_FAILED'
  | 'AUTOMATION_BUSY'
  | 'WRITE_FAILED'
  | 'INTERNAL';

export class KaragozError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
