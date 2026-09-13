export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'AppError';
  }
}
