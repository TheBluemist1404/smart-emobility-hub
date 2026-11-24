/** An error the student or operator caused; shown as a message, not a crash. */
export class UserError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code?: string) { super(message); }
}
