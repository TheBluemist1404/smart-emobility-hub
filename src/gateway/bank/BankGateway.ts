// gateway.bank — BankGateway (control method descriptions 2.6). The only outbound call to
// the bank. In the MVP the "Bank System" is a mock whose answers the simulator panel sets:
// Success, Failed (declined), Timeout (never answers) or Manual (waits for a click).
import { clock, SECOND } from "../../platform/clock/DemoClock";
import { bus } from "../../platform/events/bus";
import type { PaymentResult, PaymentType } from "../../domain/types";

export type BankMode = "Success" | "Failed" | "Timeout" | "Manual";
export interface BankAnswer { result: PaymentResult; transactionRef: string | null; failureCode: string | null }

interface Outstanding {
  requestId: string; type: PaymentType; orderRef: string; amount: number; sentAt: number;
  deliver: (a: BankAnswer) => void;
}

let txSeq = 88411;

export class BankGateway {
  private static instance: BankGateway | null = null;
  mode: BankMode = "Success";
  /** Applies to the next request only, then falls back to `mode`. */
  nextMode: BankMode | null = null;
  responseDelayMs = 4 * SECOND;
  declineReason = "insufficient balance";
  readonly outstanding = new Map<string, Outstanding>();
  readonly log: Array<{ time: number; type: PaymentType; orderRef: string; amount: number; answer: string }> = [];

  static getInstance(): BankGateway {
    if (!BankGateway.instance) BankGateway.instance = new BankGateway();
    return BankGateway.instance;
  }
  static reset(): void { BankGateway.instance = new BankGateway(); }

  /**
   * submit(type : PaymentType, orderRef : String, amount : Money) : PaymentResult
   * The answer is delivered through `deliver` on the demo clock (the real call is
   * asynchronous too). Timeout and Manual keep the request outstanding.
   */
  submit(type: PaymentType, orderRef: string, amount: number, deliver: (a: BankAnswer) => void): string {
    const mode = this.nextMode ?? this.mode;
    this.nextMode = null;
    const requestId = `BANK-${orderRef}-${clock().now()}`;
    const o: Outstanding = { requestId, type, orderRef, amount, sentAt: clock().now(), deliver };
    if (mode === "Success" || mode === "Failed") {
      clock().after(this.responseDelayMs, `Bank System answers ${orderRef} (${mode})`, () => this.answer(o, mode));
    } else {
      this.outstanding.set(requestId, o);
    }
    bus.changed("bank");
    return requestId;
  }

  /** Simulator: answer an outstanding request now (Manual mode, or a late answer after a timeout). */
  respond(requestId: string, result: PaymentResult): boolean {
    const o = this.outstanding.get(requestId);
    if (!o) return false;
    this.outstanding.delete(requestId);
    this.answer(o, result === "Success" ? "Success" : "Failed");
    return true;
  }

  private answer(o: Outstanding, mode: "Success" | "Failed"): void {
    const a: BankAnswer = mode === "Success"
      ? { result: "Success", transactionRef: `TX-20261102-${++txSeq}`, failureCode: null }
      : { result: "Failed", transactionRef: null, failureCode: this.declineReason };
    this.log.push({ time: clock().now(), type: o.type, orderRef: o.orderRef, amount: o.amount, answer: a.result });
    o.deliver(a);
    bus.changed("bank");
  }

  listOutstanding() {
    return [...this.outstanding.values()].map(({ requestId, type, orderRef, amount, sentAt }) => ({ requestId, type, orderRef, amount, sentAt }));
  }
}

export const bank = (): BankGateway => BankGateway.getInstance();
