// domain.allocation — Payment (entity method descriptions 2.8). PaymentResult has two
// values; a request still waiting for the bank has result === null (class-diagram.md 5.3).
import { clock } from "../../platform/clock/DemoClock";
import type { PaymentResult, PaymentType } from "../types";

export class Payment {
  result: PaymentResult | null = null;
  failureCode: string | null = null;
  transactionRef: string | null = null;
  settledAt: number | null = null;
  /** A result that arrived after PAYMENT_GATEWAY_TIMEOUT (UC-03 E2). */
  lateResult: PaymentResult | null = null;
  /** For a Refund: the transaction reference of the original Charge. */
  originalRef: string | null = null;
  readonly requestedAt = clock().now();
  /** True while the request is still open at the bank (no answer yet). */
  open = true;

  constructor(
    public readonly id: string,
    public readonly type: PaymentType,
    public readonly orderRef: string,
    public readonly studentId: string,
    public readonly amount: number,
    /** What the payment is for, shown on S04 ("Vehicle reservation · UC-02"). */
    public readonly purpose: string,
  ) {}

  settle(result: PaymentResult, transactionRef: string | null, failureCode: string | null): void {
    this.result = result;
    this.transactionRef = transactionRef;
    this.failureCode = failureCode;
    this.settledAt = clock().now();
    this.open = false;
  }

  /** recordLateResult(result : PaymentResult) : void — UC-03 E2. */
  recordLateResult(result: PaymentResult, transactionRef: string | null): void {
    this.lateResult = result;
    if (result === "Success") this.transactionRef = transactionRef;
    this.open = false;
    this.settledAt = clock().now();
  }

  /** isSettled() : boolean */
  isSettled(): boolean {
    return this.result !== null && !this.open;
  }
}
