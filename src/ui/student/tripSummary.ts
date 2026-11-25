// Which closed trip the Trip tab still shows instead of the scan screen.
interface ClosedTrip { id: string; endTime: number | null; fareStatus: string | null; closedByIncident: string | null }

/**
 * Unpaid (BR-PAY-04) trips stay until paid. Operator-closed (UC-12 8c) trips stay until dismissed;
 * other receipts for 30 min. A newer reservation waiting for pickup wins over an old receipt.
 */
export function summaryToShow<T extends ClosedTrip>(lt: T | null, now: number, seen: ReadonlySet<string>, pickupWaiting = false): T | null {
  if (!lt) return null;
  if (lt.fareStatus === "Unpaid") return lt; // stays until paid, even after "Done"
  if (seen.has(lt.id) || pickupWaiting) return null;
  if (lt.closedByIncident) return lt;
  return now - (lt.endTime ?? 0) < 30 * 60_000 ? lt : null;
}
