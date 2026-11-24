// One instance of each controller per boot. The routes and the tests reach them here.
import { MonitoringController } from "../control/operations/MonitoringController";
import type { StatusListener } from "../gateway/iot/StatusListener";

export interface Controllers {
  monitoring: MonitoringController;
  listeners(): StatusListener[];
  armTimers(): void;
}

export let ctl: Controllers;

export function createControllers(): Controllers {
  const monitoring = new MonitoringController();
  ctl = {
    monitoring,
    listeners: () => [monitoring],
    armTimers: () => undefined,
  };
  return ctl;
}
