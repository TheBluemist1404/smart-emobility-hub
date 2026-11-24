// control.payment — PaymentController (control method descriptions 2.5), UC-03.
// The only class that talks to the bank. Every booking controller depends on it.
import { db, nextId, audit } from "../../domain/store";
import { config } from "../../platform/config/ConfigurationRegistry";
import { clock } from "../../platform/clock/DemoClock";
import { bank, type BankAnswer } from "../../gateway/bank/BankGateway";
import { Payment } from "../../domain/allocation/Payment";
import type { PaymentResult, PaymentType } from "../../domain/types";

export interface PaymentOutcome { result: PaymentResult; transactionRef: string | null; failureCode: string | null; timedOut: boolean; payment: Payment }
export interface PaymentCallbacks {
  purpose: string;
  /** Called once with Success or Failed (a timeout is Failed, failureCode "timeout"). */
  onResult: (o: PaymentOutcome) => void;
  /** Called if the bank answers after PAYMENT_GATEWAY_TIMEOUT (UC-03 E2). */
  onLate?: (o: PaymentOutcome) => void;
}

export class PaymentController {
  private readonly late = new Map<string, (o: PaymentOutcome) => void>();

  /**
   * processPayment(type, orderRef, studentId, amount) : PaymentResult — UC-03 steps 1-6, E1, E2.
   * The result arrives asynchronously (the bank call is asynchronous), through onResult.
   * While a request for the same orderRef is still open, no second one is sent.
   */
  processPayment(type: PaymentType, orderRef: string, studentId: string, amount: number, cb: PaymentCallbacks): Payment {
    const open = [...db.payments.values()].find((p) => p.orderRef === orderRef && p.type === type && p.open);
    if (open) return open;
    if (!(amount > 0)) throw new Error("UC-03 precondition: amount must be greater than 0");

    const p = new Payment(nextId("PAY", "num"), type, orderRef, studentId, amount, cb.purpose);
    if (type === "Refund") p.originalRef = [...db.payments.values()].find((x) => x.orderRef === orderRef && x.type === "Charge" && (x.result === "Success" || x.lateResult === "Success"))?.transactionRef ?? null;
    db.payments.set(p.id, p);
    if (cb.onLate) this.late.set(p.id, cb.onLate);

    const outcome = (a: BankAnswer, timedOut: boolean): PaymentOutcome => ({ ...a, timedOut, payment: p });
    const timer = clock().after(config().value("PAYMENT_GATEWAY_TIMEOUT"), `PAYMENT_GATEWAY_TIMEOUT ${orderRef}`, () => {
      if (p.result !== null) return;
      p.settle("Failed", null, "timeout");
      p.open = true; // E2: the request stays open; a late answer is still recorded.
      audit("system", `UC-03 ${type} timed out`, orderRef);
      cb.onResult(outcome({ result: "Failed", transactionRef: null, failureCode: "timeout" }, true));
    });

    bank().submit(type, orderRef, amount, (a) => {
      if (p.result === null) {
        timer.cancel();
        p.settle(a.result, a.transactionRef, a.failureCode);
        audit("system", `UC-03 ${type} ${a.result}`, orderRef, undefined, a.transactionRef ?? a.failureCode ?? "");
        cb.onResult(outcome(a, false));
      } else {
        this.recordLateResult(p.id, a);
      }
    });
    return p;
  }

  /** recordLateResult(result : PaymentResult) : void — UC-03 E2. */
  recordLateResult(paymentId: string, a: BankAnswer): void {
    const p = db.payments.get(paymentId);
    if (!p) return;
    p.recordLateResult(a.result, a.transactionRef);
    audit("system", `UC-03 late ${a.result}`, p.orderRef, undefined, a.transactionRef ?? "");
    this.late.get(p.id)?.({ ...a, timedOut: true, payment: p });
  }

  /** NIFR-05: a full refund of the Charge recorded under orderRef (BR-PAY-02, BR-PAY-03). */
  refund(orderRef: string, studentId: string, amount: number, purpose: string, onDone?: (o: PaymentOutcome) => void): Payment | null {
    if (!(amount > 0)) return null;
    return this.processPayment("Refund", orderRef, studentId, amount, { purpose: `Refund · ${purpose}`, onResult: (o) => onDone?.(o), onLate: (o) => onDone?.(o) });
  }

  /** The latest payment for an order, for the S04 screen. */
  latestFor(orderRef: string, type: PaymentType = "Charge"): Payment | null {
    return [...db.payments.values()].filter((p) => p.orderRef === orderRef && p.type === type).sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null;
  }
}
