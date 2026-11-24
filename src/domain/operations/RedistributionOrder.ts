// domain.operations — RedistributionOrder (3.4) and its per-vehicle VehicleTransfer (3.5 in
// VehicleTransfer.ts). OrderStatus: Draft, Assigned, In Transit, Completed, Partially
// Completed, Cancelled; "Overdue" is a flag (BR-06, E4).
import { clock } from "../../platform/clock/DemoClock";
import type { OrderStatus } from "../types";
import type { VehicleTransfer } from "./VehicleTransfer";

export class RedistributionOrder {
  status: OrderStatus = "Draft";
  overdue = false;
  transfers: VehicleTransfer[] = [];
  readonly createdAt = clock().now();
  readonly history: Array<{ time: number; status: string; note?: string }> = [];
  cancelReason: string | null = null;

  constructor(
    public readonly id: string,
    public readonly fromHub: string,
    public toHub: string,
    public readonly model: string,
    public readonly quantity: number,
    public readonly deadline: number,
    public readonly createdBy: string,
    public readonly source: "manual" | "simulation" | "incident",
  ) {
    this.history.push({ time: this.createdAt, status: "Draft" });
  }

  /** setStatus(status : OrderStatus) : void */
  setStatus(status: OrderStatus, note?: string): void {
    this.status = status;
    this.history.push({ time: clock().now(), status, note });
  }

  /** flagOverdue() : void — a prompt, not an automatic close. UC-10 E4. */
  flagOverdue(): void {
    this.overdue = true;
  }

  /** aggregate() : OrderStatus — BR-RED-01: Completed when every transfer Arrived, else Partially Completed. */
  aggregate(): OrderStatus {
    return this.transfers.length > 0 && this.transfers.every((t) => t.status === "Arrived") ? "Completed" : "Partially Completed";
  }

  isOpen(): boolean { return this.status === "Assigned" || this.status === "In Transit"; }

  /** isOverdue() : boolean */
  isOverdue(): boolean {
    return clock().now() > this.deadline && this.isOpen();
  }
}
