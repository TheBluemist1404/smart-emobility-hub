// Generates seed/seed.json — the hard-coded sample data of the MVP (the brief allows it).
// Same sample data as the Sub2 UI mockups: student Nguyen Minh Khoa · 2412345, operator
// Tran Lan · OP-014, Hubs H01–H07, clock Mon 02/11/2026 14:36. Deterministic: run it again
// and the file is identical.  Run with:  npm run seed
import { writeFileSync } from "node:fs";

const iso = (dm: string, hms: string) => {
  const [d, m] = dm.split("/").map(Number);
  const [h, mi, s = 0] = hms.split(":").map(Number);
  return new Date(Date.UTC(2026, m - 1, d, h - 7, mi, s)).toISOString();
};
const T = (hms: string) => iso("02/11", hms);

type VT = "electric bicycle" | "electric motorcycle";
interface HubSpec { id: string; name: string; category: string; open: string; x: number; y: number; docks: number; points: Array<"AC 7 kW" | "DC 22 kW">; eb: number; em: number; freeEb: number; freeEm: number; updated: string;
  mix: { available: number; waiting: number; charging: number } }

const HUBS: HubSpec[] = [
  { id: "H01", name: "KTX Khu A", category: "Dormitory", open: "05:00–23:00", x: 66, y: 30, docks: 40, points: ["AC 7 kW", "AC 7 kW", "DC 22 kW", "DC 22 kW"], eb: 20, em: 18, freeEb: 8, freeEm: 6, updated: "14:36:05", mix: { available: 0, waiting: 0, charging: 0 } },
  { id: "H02", name: "KTX Khu B", category: "Dormitory", open: "05:00–23:00", x: 84, y: 56, docks: 30, points: ["AC 7 kW", "AC 7 kW", "AC 7 kW", "AC 7 kW", "DC 22 kW", "DC 22 kW"], eb: 8, em: 6, freeEb: 1, freeEm: 1, updated: "14:36:02", mix: { available: 0, waiting: 0, charging: 5 } },
  { id: "H03", name: "Ga Metro ĐHQG", category: "Metro", open: "05:00–23:30", x: 22, y: 82, docks: 60, points: ["AC 7 kW", "AC 7 kW", "AC 7 kW", "AC 7 kW", "DC 22 kW", "DC 22 kW", "DC 22 kW", "DC 22 kW"], eb: 16, em: 12, freeEb: 5, freeEm: 4, updated: "14:36:06", mix: { available: 26, waiting: 16, charging: 6 } },
  { id: "H04", name: "ĐH Bách khoa (Dĩ An)", category: "School", open: "06:00–22:00", x: 48, y: 12, docks: 36, points: ["AC 7 kW", "AC 7 kW", "AC 7 kW", "AC 7 kW", "AC 7 kW", "DC 22 kW", "DC 22 kW", "DC 22 kW"], eb: 12, em: 10, freeEb: 6, freeEm: 4, updated: "14:36:03", mix: { available: 3, waiting: 11, charging: 2 } },
  { id: "H05", name: "Nhà Văn hóa Sinh viên", category: "Service", open: "06:00–22:00", x: 56, y: 68, docks: 24, points: ["AC 7 kW", "AC 7 kW", "AC 7 kW", "AC 7 kW", "DC 22 kW", "DC 22 kW"], eb: 10, em: 8, freeEb: 7, freeEm: 4, updated: "14:36:04", mix: { available: 8, waiting: 2, charging: 1 } },
  { id: "H06", name: "ĐH KHTN (Linh Trung)", category: "School", open: "06:00–22:00", x: 14, y: 20, docks: 20, points: ["AC 7 kW", "AC 7 kW", "DC 22 kW", "DC 22 kW"], eb: 8, em: 6, freeEb: 4, freeEm: 3, updated: "14:29:40", mix: { available: 6, waiting: 4, charging: 0 } },
  { id: "H07", name: "Thư viện Trung tâm", category: "Service", open: "06:30–22:00", x: 30, y: 44, docks: 20, points: ["AC 7 kW", "AC 7 kW", "AC 7 kW", "DC 22 kW", "DC 22 kW"], eb: 6, em: 6, freeEb: 3, freeEm: 2, updated: "14:36:06", mix: { available: 9, waiting: 4, charging: 2 } },
];

// Deterministic pseudo-random numbers.
let seed = 20261102;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));

const out = {
  meta: { generatedBy: "seed/generate.ts", clock: T("14:36:00"), student: "2412345", operator: "OP-014" },
  hubs: [] as unknown[], docks: [] as unknown[], vehicles: [] as unknown[], points: [] as unknown[], spaces: [] as unknown[],
  students: [] as unknown[], vehicleReservations: [] as unknown[], parkingReservations: [] as unknown[], chargingSessions: [] as unknown[],
  trips: [] as unknown[], payments: [] as unknown[], reports: [] as unknown[], incidents: [] as unknown[], orders: [] as unknown[],
  notifications: [] as unknown[], alerts: [] as unknown[],
};

const D = (hub: string, n: number) => `${hub}-D${String(n).padStart(2, "0")}`;
const usedIds = new Set<string>();
let ebSeq = 300, emSeq = 100;
const newVid = (t: VT) => {
  let id: string;
  do { id = t === "electric bicycle" ? `EB-0${ebSeq++}` : `EM-0${String(emSeq++).padStart(3, "0")}`; } while (usedIds.has(id));
  usedIds.add(id); return id;
};
["EB-0217", "EB-0221", "EM-0038", "EB-0226", "EB-0230", "EM-0031", "EM-0042", "EB-0212", "EB-0215", "EB-0218", "EB-0223", "EB-0244", "EB-0251", "EB-0239", "EB-0260", "EB-0262"].forEach((x) => usedIds.add(x));

interface V { id: string; hubId: string; type: VT; soc: number; dock: string | null; usage?: string; heldBy?: string; orderId?: string; odometerKm: number; updated: string }
const vehicles: V[] = [];
const addV = (v: Omit<V, "odometerKm" | "updated"> & { updated?: string }) => {
  const full: V = { odometerKm: between(120, 2400), updated: v.updated ?? T("14:36:05"), ...v };
  vehicles.push(full);
  return full;
};

let otherStudent = 2412001;
const others: Array<{ id: string; name: string }> = [];
const newOther = () => { const id = String(otherStudent++); others.push({ id, name: `Student ${id}` }); return id; };

for (const h of HUBS) {
  out.hubs.push({ id: h.id, name: h.name, category: h.category, openHours: h.open, x: h.x, y: h.y, lastUpdate: T(h.updated) });
  for (let i = 1; i <= h.docks; i++) out.docks.push({ id: D(h.id, i), hubId: h.id, label: `D-${String(i).padStart(2, "0")}` });
  h.points.forEach((p, i) => out.points.push({ id: `CP-${h.id}-0${i + 1}`, hubId: h.id, power: p }));
  for (let i = 1; i <= h.eb; i++) out.spaces.push({ id: `${h.id}-P-A${String(i).padStart(2, "0")}`, hubId: h.id, label: `P-A${String(i).padStart(2, "0")}`, type: "electric bicycle" });
  for (let i = 1; i <= h.em; i++) out.spaces.push({ id: `${h.id}-P-B${String(i).padStart(2, "0")}`, hubId: h.id, label: `P-B${String(i).padStart(2, "0")}`, type: "electric motorcycle" });
}

// ---- H01 KTX Khu A — exactly the vehicles of mockup S02 ----------------------------
addV({ id: "EB-0217", hubId: "H01", type: "electric bicycle", soc: 78, dock: D("H01", 7) });
addV({ id: "EB-0221", hubId: "H01", type: "electric bicycle", soc: 91, dock: D("H01", 11) });
addV({ id: "EM-0038", hubId: "H01", type: "electric motorcycle", soc: 64, dock: D("H01", 14) });
addV({ id: "EB-0226", hubId: "H01", type: "electric bicycle", soc: 55, dock: D("H01", 18), usage: "Reserved", heldBy: "2412088" });
addV({ id: "EB-0230", hubId: "H01", type: "electric bicycle", soc: 14, dock: D("H01", 21) });
addV({ id: "EM-0031", hubId: "H01", type: "electric motorcycle", soc: 47, dock: D("H01", 25) });
addV({ id: "EB-0212", hubId: "H01", type: "electric bicycle", soc: 86, dock: D("H01", 3), updated: T("14:31:00") }); // arrived with RO-0312

// ---- H02 KTX Khu B — Overloaded and short of vehicles (mockup O01) ------------------
{
  let d = 1;
  addV({ id: "EB-0244", hubId: "H02", type: "electric bicycle", soc: 92, dock: D("H02", d++), updated: T("14:36:02") });
  addV({ id: "EB-0251", hubId: "H02", type: "electric bicycle", soc: 88, dock: D("H02", d++), updated: T("14:36:02") });
  const r1 = addV({ id: newVid("electric bicycle"), hubId: "H02", type: "electric bicycle", soc: 70, dock: D("H02", d++), usage: "Reserved", heldBy: "2412090", updated: T("14:36:02") });
  const r2 = addV({ id: newVid("electric motorcycle"), hubId: "H02", type: "electric motorcycle", soc: 66, dock: D("H02", d++), usage: "Reserved", heldBy: "2412091", updated: T("14:36:02") });
  out.vehicleReservations.push(
    { id: "VR-8H2D", studentId: "2412090", vehicleId: r1.id, hubId: "H02", status: "Confirmed", fee: 5000, tx: "TX-20261102-88390", created: T("14:26:10"), expires: T("14:41:10") },
    { id: "VR-9K3E", studentId: "2412091", vehicleId: r2.id, hubId: "H02", status: "Confirmed", fee: 5000, tx: "TX-20261102-88401", created: T("14:33:40"), expires: T("14:48:40") },
  );
  addV({ id: "EB-0239", hubId: "H02", type: "electric bicycle", soc: 84, dock: D("H02", d++), usage: "charging", updated: T("14:36:02") });
  addV({ id: "EB-0260", hubId: "H02", type: "electric bicycle", soc: 81, dock: D("H02", d++), usage: "charging", updated: T("14:36:02") });
  addV({ id: "EB-0262", hubId: "H02", type: "electric bicycle", soc: 63, dock: D("H02", d++), usage: "charging", updated: T("14:36:02") });
  for (let i = 0; i < 2; i++) addV({ id: newVid("electric bicycle"), hubId: "H02", type: "electric bicycle", soc: between(30, 60), dock: D("H02", d++), usage: "charging", updated: T("14:36:02") });
  while (d <= 29) { const ty: VT = rnd() < 0.7 ? "electric bicycle" : "electric motorcycle"; addV({ id: newVid(ty), hubId: "H02", type: ty, soc: between(6, 19), dock: D("H02", d++), updated: T("14:36:02") }); }
}
// RO-0314: three H04 vehicles already in an Assigned order to H03.
const ro0314: string[] = [];
for (const h of HUBS.filter((x) => !["H01", "H02"].includes(x.id))) {
  let d = 1;
  const t = () => (rnd() < 0.7 ? "electric bicycle" : "electric motorcycle") as VT;
  for (let i = 0; i < h.mix.available; i++) { const ty = t(); addV({ id: newVid(ty), hubId: h.id, type: ty, soc: between(45, 98), dock: D(h.id, d++), updated: T(h.updated) }); }
  if (h.id === "H04") for (let i = 0; i < 3; i++) { const v = addV({ id: newVid("electric bicycle"), hubId: "H04", type: "electric bicycle", soc: between(82, 95), dock: D("H04", d++), usage: "In Redistribution", orderId: "RO-0314", updated: T(h.updated) }); ro0314.push(v.id); }
  for (let i = 0; i < h.mix.waiting; i++) { const ty = t(); addV({ id: newVid(ty), hubId: h.id, type: ty, soc: between(5, 19), dock: D(h.id, d++), updated: T(h.updated) }); }
  for (let i = 0; i < h.mix.charging; i++) { const ty = t(); addV({ id: newVid(ty), hubId: h.id, type: ty, soc: between(25, 75), dock: D(h.id, d++), usage: "charging", updated: T(h.updated) }); }
}
// RO-0312 in transit from H03 to H01: EB-0215, EB-0218 on the road (no dock), EB-0223 broke down.
addV({ id: "EB-0215", hubId: "H03", type: "electric bicycle", soc: 83, dock: null, usage: "In Redistribution", orderId: "RO-0312", updated: T("14:36:01") });
addV({ id: "EB-0218", hubId: "H03", type: "electric bicycle", soc: 85, dock: null, usage: "In Redistribution", orderId: "RO-0312", updated: T("14:36:01") });
addV({ id: "EB-0223", hubId: "H03", type: "electric bicycle", soc: 52, dock: null, updated: T("14:36:01") });
// EM-0042 is on a trip by another student and broke down (INC-0192, mockup O04).
addV({ id: "EM-0042", hubId: "H03", type: "electric motorcycle", soc: 61, dock: null, usage: "In Use", heldBy: "2412077", updated: T("14:34:02") });

// Shared vehicles "charging": a Charging Queue request already Charging on a point of their Hub.
let cq = 1;
for (const h of HUBS) {
  const charging = vehicles.filter((v) => v.hubId === h.id && v.usage === "charging");
  const free = out.points.filter((p) => (p as { hubId: string }).hubId === h.id) as Array<{ id: string }>;
  charging.forEach((v, i) => {
    const p = free[i % free.length];
    out.chargingSessions.push({ id: `CQ-S${String(cq++).padStart(3, "0")}`, kind: "Charging Queue request", studentId: "system", vehicleRef: v.id, hubId: h.id, pointId: p.id,
      status: "Charging", start: T("14:15:00"), end: T("15:15:00"), waitingSince: T("13:40:00"), targetSoc: 90 });
    delete v.usage;
  });
}

// ---- Students -----------------------------------------------------------------------
out.students.push({ id: "2412345", name: "Nguyen Minh Khoa", email: "khoa.nm@student.example", vehicles: [{ id: "59-X3 123.45", type: "electric motorcycle", batteryKwh: 2.4 }] });
out.students.push({ id: "2412088", name: "Pham Gia Huy", email: "huy@student.example", vehicles: [] });
out.students.push({ id: "2412090", name: "Vo Thanh Tam", email: "tam@student.example", vehicles: [] });
out.students.push({ id: "2412091", name: "Do Bao Ngoc", email: "ngoc@student.example", vehicles: [] });
out.students.push({ id: "2412077", name: "Le Thi Mai", email: "mai@student.example", vehicles: [] });
out.students.push({ id: "2412102", name: "Tran Quoc Bao", email: "bao@student.example", vehicles: [{ id: "51-K2 678.90", type: "electric motorcycle", batteryKwh: 2.4 }] });

out.vehicleReservations.push({ id: "VR-6P1A", studentId: "2412088", vehicleId: "EB-0226", hubId: "H01", status: "Confirmed", fee: 5000, tx: "TX-20261102-88405", created: T("14:32:00"), expires: T("14:47:00") });

// Khoa's history (mockup S11 b).
out.vehicleReservations.push({ id: "VR-5T2C", studentId: "2412345", vehicleId: "EB-0204", hubId: "H02", status: "Cancelled by System", fee: 5000, tx: "TX-20261027-71230", created: iso("27/10", "09:10"), expires: iso("27/10", "09:25"), refund: "Success" });
out.parkingReservations.push({ id: "PR-2KQ1", studentId: "2412345", spaceId: "H05-P-B03", hubId: "H05", status: "Expired", fee: 15000, tx: "TX-20261028-72010", start: iso("28/10", "07:30"), end: iso("28/10", "12:00"), plate: "59-X3 123.45", created: iso("27/10", "21:00") });
out.chargingSessions.push({ id: "CS-3WQA", kind: "committed reservation", studentId: "2412345", vehicleRef: "59-X3 123.45", hubId: "H01", pointId: "CP-H01-02", status: "Payment Failed", start: iso("26/10", "18:00"), end: iso("26/10", "19:00"), fee: 12000, created: iso("26/10", "17:20") });
// Khoa's active charging session, already moved 15 min later by UC-11 (S11 a, S12).
out.chargingSessions.push({ id: "CS-5HDP", kind: "committed reservation", studentId: "2412345", vehicleRef: "59-X3 123.45", hubId: "H01", pointId: "CP-H01-03", status: "Scheduled", start: T("15:30:00"), end: T("16:45:00"), originalStart: T("15:15:00"), neededBy: T("17:00:00"), fee: 18500, tx: "TX-20261102-88371", created: T("11:40:00"), currentSoc: 32, targetSoc: 80 });
// Another student is charging on CP-H01-01 until 15:10 (S02 b).
out.chargingSessions.push({ id: "CS-7RNB", kind: "committed reservation", studentId: "2412102", vehicleRef: "51-K2 678.90", hubId: "H01", pointId: "CP-H01-01", status: "Charging", start: T("14:10:00"), end: T("15:10:00"), originalStart: T("14:10:00"), fee: 14000, tx: "TX-20261102-88310", created: T("13:50:00"), currentSoc: 40, targetSoc: 90 });

// INC-0189 blocked P-B12 at 14:02: PR-4K1C moved to P-B07, Khoa's PR-3MZ8 had no replacement.
out.parkingReservations.push({ id: "PR-3MZ8", studentId: "2412345", spaceId: "H01-P-B12", hubId: "H01", status: "Cancelled by System", fee: 15000, tx: "TX-20261102-88350", start: T("16:00:00"), end: T("21:30:00"), plate: "59-X3 123.45", created: T("10:20:00"), refund: "pending" });
out.parkingReservations.push({ id: "PR-4K1C", studentId: "2412102", spaceId: "H01-P-B07", hubId: "H01", status: "Confirmed", fee: 9000, tx: "TX-20261102-88341", start: T("17:00:00"), end: T("20:00:00"), plate: "51-K2 678.90", created: T("09:30:00"), movedFrom: "P-B12" });

// Occupied parking spaces right now: other students, Checked-in (keeps the S01/S05 free counts).
for (const h of HUBS) {
  for (const [type, prefix, total, free] of [["electric bicycle", "P-A", h.eb, h.freeEb], ["electric motorcycle", "P-B", h.em, h.freeEm]] as const) {
    let occupied = total - free;
    for (let i = total; i >= 1 && occupied > 0; i--) {
      const label = `${prefix}${String(i).padStart(2, "0")}`;
      if (h.id === "H01" && label === "P-B12") continue; // out of service, counted as not free
      const sid = newOther();
      out.parkingReservations.push({ id: `PR-S${h.id.slice(1)}${String(i).padStart(2, "0")}${prefix.slice(-1)}`, studentId: sid, spaceId: `${h.id}-${label}`, hubId: h.id, status: "Checked-in", fee: 9000,
        tx: `TX-20261102-7${h.id.slice(1)}${String(i).padStart(3, "0")}`, start: T(`${String(between(9, 13)).padStart(2, "0")}:00:00`), end: T(`${String(between(15, 20)).padStart(2, "0")}:30:00`), plate: `${type === "electric bicycle" ? "EB" : "59-Z"} ${sid.slice(-3)}`, created: T("08:00:00") });
      occupied--;
    }
  }
}

// ---- Incidents (mockup O04) ---------------------------------------------------------
out.incidents.push(
  { id: "INC-0187", resourceId: "CP-H01-04", hubId: "H01", category: "charging point unavailable or faulty", description: "Charging point reports a hardware fault (UC-11 E3).", source: "system", status: "Open", created: T("14:12:00"), blocking: true },
  { id: "INC-0189", resourceId: "H01-P-B12", hubId: "H01", category: "parking space blocked or occupied", description: "Barrier at P-B12 stuck down; space unusable.", source: "operator", status: "In Progress", created: T("13:58:00"), blocking: true, owner: "OP-014",
    actions: [{ note: "Started handling · barrier stuck, technician called", time: T("14:00:00") }, { note: "Blocked P-B12 · PR-4K1C moved to P-B07, PR-3MZ8 cancelled (no replacement) and refund requested", time: T("14:02:00"), block: true }] },
  { id: "INC-0191", resourceId: "H06", hubId: "H06", category: "Hub disconnected", description: "No data from H06 since 14:29:40 (over DATA_STALE_AFTER).", source: "network warning", status: "Open", created: T("14:30:45"), blocking: false },
  { id: "INC-0192", resourceId: "EM-0042", hubId: "H03", category: "vehicle failure", description: "The motor cut out and won't restart. Battery shows 61%.", source: "student report", status: "In Progress", created: T("14:31:00"), blocking: false, owner: "OP-014",
    actions: [{ note: "Started handling · called student, motor dead", time: T("14:33:00") }] },
  { id: "INC-0183", resourceId: "H05-D07", hubId: "H05", category: "Hub facility problem", description: "Dock D-07 latch sticky.", source: "student report", status: "Resolved", created: T("09:12:00"), blocking: true, resolution: "Latch cleaned and tested." },
  { id: "INC-0185", resourceId: "CP-H05-02", hubId: "H05", category: "charging point unavailable or faulty", description: "Cable holster broken.", source: "student report", status: "Resolved", created: iso("31/10", "10:20"), blocking: false, resolution: "Holster replaced." },
  { id: "INC-0186", resourceId: "EB-0221", hubId: "H01", category: "vehicle failure", description: "Bell missing.", source: "student report", status: "Dismissed", created: T("08:40:00"), blocking: false, dismissReason: "Not a failure: bell is optional equipment." },
);
out.reports.push(
  { id: "IR-20261102-034", studentId: "2412077", resourceId: "EM-0042", hubId: "H03", category: "vehicle failure", description: "The motor cut out and won't restart. Battery shows 61%.", photos: 1, time: T("14:31:00"), incidentId: "INC-0192", status: "Open" },
  { id: "IR-20261031-012", studentId: "2412345", resourceId: "CP-H05-02", hubId: "H05", category: "charging point unavailable or faulty", description: "The cable holster is broken, the plug falls out.", photos: 2, time: iso("31/10", "10:15"), incidentId: "INC-0185", status: "Closed" },
);
out.trips.push({ id: "TR-0941", studentId: "2412077", vehicleId: "EM-0042", hubId: "H03", reservationId: null, start: T("14:00:00"), startSoc: 72, startDock: "D-09", status: "Open" });

// ---- Redistribution orders (mockup O02) --------------------------------------------
out.orders.push(
  { id: "RO-0314", fromHub: "H04", toHub: "H03", model: "e-bike", quantity: 3, deadline: T("14:20:00"), status: "Assigned", created: T("13:35:00"), team: "Team A", transfers: ro0314.map((v, i) => ({ vehicleId: v, status: "Assigned", destDock: D("H03", 55 + i) })) },
  { id: "RO-0312", fromHub: "H03", toHub: "H01", model: "e-bike", quantity: 4, deadline: T("14:50:00"), status: "In Transit", created: T("13:50:00"), team: "Team B",
    transfers: [{ vehicleId: "EB-0212", status: "Arrived", destDock: D("H01", 3) }, { vehicleId: "EB-0215", status: "In Transit", destDock: D("H01", 4) }, { vehicleId: "EB-0218", status: "In Transit", destDock: D("H01", 5) }, { vehicleId: "EB-0223", status: "Removed", destDock: null }] },
  { id: "RO-0313", fromHub: "H02", toHub: "H07", model: "e-bike", quantity: 2, deadline: T("16:00:00"), status: "Draft", created: T("14:05:00"), team: "—", transfers: [] },
  { id: "RO-0310", fromHub: "H02", toHub: "H05", model: "e-bike", quantity: 3, deadline: T("13:30:00"), status: "Completed", created: T("12:40:00"), team: "Team B", transfers: [] },
  { id: "RO-0309", fromHub: "H01", toHub: "H04", model: "e-bike", quantity: 3, deadline: T("12:45:00"), status: "Partially Completed", created: T("11:50:00"), team: "Team A", transfers: [] },
  { id: "RO-0307", fromHub: "H06", toHub: "H05", model: "e-bike", quantity: 2, deadline: T("11:00:00"), status: "Cancelled", created: T("10:10:00"), team: "—", transfers: [] },
);

// ---- Khoa's notifications (mockup S12) ---------------------------------------------
out.notifications.push(
  { id: "NT-0003", studentId: "2412345", time: T("14:02:00"), title: "Parking reservation cancelled", body: "Parking space P-B12 is blocked and no replacement is free. Reservation PR-3MZ8 was cancelled and 15,000 VND will be refunded.", tone: "danger", ref: "PR-3MZ8", read: false },
  { id: "NT-0002", studentId: "2412345", time: T("12:58:00"), title: "Charging session moved", body: "Your charging session CS-5HDP moved from 15:15 to 15:30 at CP-H01-03 (within 15 min, before your needed-by 17:00).", tone: "info", ref: "CS-5HDP", read: false },
  { id: "NT-0001", studentId: "2412345", time: iso("31/10", "16:20"), title: "Report resolved", body: "Report IR-20261031-012 about CP-H05-02 was resolved by an operator.", tone: "ok", ref: "IR-20261031-012", read: true },
);
out.alerts.push({ id: "AL-0040", time: T("14:21:00"), hubId: "H02", kind: "Overload warning (5a)", message: "H02 dock occupancy at 97% with Vehicle Shortage." });

out.students.push(...others.map((o) => ({ ...o, email: "", vehicles: [] })));
out.vehicles = vehicles;

writeFileSync(new URL("./seed.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`seed.json: ${out.hubs.length} hubs, ${out.docks.length} docks, ${vehicles.length} vehicles, ${out.points.length} points, ${out.spaces.length} spaces, ${out.parkingReservations.length} parking reservations, ${out.chargingSessions.length} charging sessions`);
