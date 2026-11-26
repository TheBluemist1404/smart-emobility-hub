// domain.operations — the one rule for moving vehicles out of a too-full Hub, shared by UC-10
// suggestions (O02), the UC-09 5a "Create Redistribution Order" panel and the UC-13 recommendations.
//
// One source can feed several destinations: the nearest destination first, each filled only up to
// its safe ceiling (HUB_BUSY, 70 % of its docks in service, counting docks already promised to
// open orders), then the next nearest, until the excess is placed or no destination has room.

/** What the planner needs to know about a possible destination. */
export interface DestinationState {
  hubId: string; x: number; y: number;
  docksInService: number; occupiedDocks: number; vacantDocks: number;
  /** Docks already promised to open orders (Allocated). They count as filled. */
  allocatedDocks?: number;
}

export interface OutflowLeg { toHub: string; quantity: number; km: number; room: number }
export interface OutflowPlan { legs: OutflowLeg[]; placed: number; left: number }

/** Schematic distance on the campus map, the same scale the monitor uses (0.04 km per unit). */
export function kmBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 0.04 * 10) / 10;
}

/** Docks a Hub can still take while staying at or below `ceilingPct` of its docks in service. */
export function safeRoom(h: DestinationState, ceilingPct: number): number {
  const ceiling = Math.floor((ceilingPct / 100) * h.docksInService);
  return Math.max(0, Math.min(h.vacantDocks, ceiling - h.occupiedDocks - (h.allocatedDocks ?? 0)));
}

/** How many vehicles must leave a Hub to bring it down to `ceilingPct` of its docks in service. */
export function excessOver(h: { docksInService: number; occupiedDocks: number }, ceilingPct: number): number {
  return Math.max(0, h.occupiedDocks - Math.floor((ceilingPct / 100) * h.docksInService));
}

/**
 * planOutflow — nearest destination first, each up to its safe room, until `excess` is placed.
 * `room` overrides safeRoom for a destination (the simulation passes what is left after earlier legs).
 */
export function planOutflow(
  source: { hubId: string; x: number; y: number },
  excess: number,
  destinations: DestinationState[],
  ceilingPct: number,
  room: (d: DestinationState) => number = (d) => safeRoom(d, ceilingPct),
): OutflowPlan {
  const legs: OutflowLeg[] = [];
  let left = Math.max(0, Math.floor(excess));
  const ordered = destinations
    .filter((d) => d.hubId !== source.hubId)
    .map((d) => ({ d, km: kmBetween(source, d), room: room(d) }))
    .filter((x) => x.room > 0)
    .sort((a, b) => a.km - b.km || b.room - a.room || a.d.hubId.localeCompare(b.d.hubId));
  for (const x of ordered) {
    if (left <= 0) break;
    const q = Math.min(left, x.room);
    legs.push({ toHub: x.d.hubId, quantity: q, km: x.km, room: x.room });
    left -= q;
  }
  return { legs, placed: legs.reduce((s, l) => s + l.quantity, 0), left };
}
