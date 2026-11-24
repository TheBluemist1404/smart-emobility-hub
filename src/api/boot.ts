// Phase 0: read the seed file so both views can show it. Phase 1 builds the entities from it.
import { readFileSync } from "node:fs";

export let seed: Record<string, unknown[]> & { meta?: unknown } = {} as never;

export function boot(): void {
  seed = JSON.parse(readFileSync(new URL("../../seed/seed.json", import.meta.url), "utf-8"));
}
