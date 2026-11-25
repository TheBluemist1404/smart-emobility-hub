// Which demo simulators are not in their normal "Success" setting. The bank and dock-unlock
// modes are shared by everyone on the URL, so the views warn when one of them is off.
export interface SimModes {
  bank: { mode: string; nextMode: string | null };
  unlock: { mode: string; nextMode: string | null };
}

/** One short line per simulator that is not at Success; empty when all is normal. */
export function simulatorWarnings(s: SimModes): string[] {
  const out: string[] = [];
  if (s.bank.mode !== "Success") out.push(`Bank answers every payment with ${s.bank.mode}`);
  if (s.bank.nextMode && s.bank.nextMode !== "Success") out.push(`Bank answers the next payment with ${s.bank.nextMode}`);
  if (s.unlock.mode !== "Success") out.push(`Dock unlock answers ${s.unlock.mode}`);
  if (s.unlock.nextMode && s.unlock.nextMode !== "Success") out.push(`Next dock unlock answers ${s.unlock.nextMode}`);
  return out;
}
