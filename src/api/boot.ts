// Composition root: config, clock, gateways, seed, controllers, listeners. boot() can run
// again at any time ("Reset demo") and gives a fresh system at Mon 02/11/2026 14:36:00.
import { ConfigurationRegistry } from "../platform/config/ConfigurationRegistry";
import { DemoClock, clock, setClock } from "../platform/clock/DemoClock";
import { BankGateway } from "../gateway/bank/BankGateway";
import { IoTDataGateway, iot } from "../gateway/iot/IoTDataGateway";
import { SimulatedDataSource, dataSource } from "../gateway/iot/SimulatedDataSource";
import { loadSeed } from "./seedLoader";
import { createControllers } from "./controllers";
import { bus } from "../platform/events/bus";

export interface BootOptions { realtime?: boolean }

export function boot(opts: BootOptions = { realtime: true }): void {
  clock().stop();
  const c = new DemoClock();
  if (!opts.realtime) c.pause();
  setClock(c);
  ConfigurationRegistry.reset();
  BankGateway.reset();
  IoTDataGateway.reset();
  SimulatedDataSource.reset();
  loadSeed();
  const ctl = createControllers();
  for (const l of ctl.listeners()) iot().subscribe(l);
  dataSource().start();
  dataSource().disconnectHub("H06"); // H06 has been silent since 14:29:40 (mockup O01).
  ctl.monitoring.checkStale(true);
  ctl.monitoring.startSweep();
  ctl.armTimers();
  if (opts.realtime) c.start();
  bus.changed("boot");
}
