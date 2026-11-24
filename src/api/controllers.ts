// One instance of each controller per boot. The routes and the tests reach them here.
import { MonitoringController } from "../control/operations/MonitoringController";
import { PaymentController } from "../control/payment/PaymentController";
import { SearchController } from "../control/booking/SearchController";
import { ReservationController } from "../control/booking/ReservationController";
import { RentalController } from "../control/booking/RentalController";
import { IssueController } from "../control/booking/IssueController";
import { ChargingController } from "../control/operations/ChargingController";
import { RedistributionController } from "../control/operations/RedistributionController";
import { IncidentController } from "../control/operations/IncidentController";
import { SimulationController } from "../control/operations/SimulationController";
import type { IoTEvent, StatusListener } from "../gateway/iot/StatusListener";

export interface Controllers {
  monitoring: MonitoringController;
  payment: PaymentController;
  search: SearchController;
  reservation: ReservationController;
  rental: RentalController;
  issue: IssueController;
  charging: ChargingController;
  redistribution: RedistributionController;
  incident: IncidentController;
  simulation: SimulationController;
  listeners(): StatusListener[];
  armTimers(): void;
}

export let ctl: Controllers;

export function createControllers(): Controllers {
  const monitoring = new MonitoringController();
  const payment = new PaymentController();
  const search = new SearchController();
  const reservation = new ReservationController(payment);
  const rental = new RentalController(payment, reservation);
  const issue = new IssueController(rental);
  const charging = new ChargingController(payment);
  const redistribution = new RedistributionController();
  const incident = new IncidentController(reservation, rental, charging, redistribution);
  const simulation = new SimulationController();
  // ReservationController is not a StatusListener in the design; the parking sensor event
  // reaches it through this small adapter (UC-04 step 14).
  const parkingSensor: StatusListener = { onIoTEvent: (e: IoTEvent) => { if (e.type === "parkingSensor") reservation.parkingSensor(e.spaceId, e.occupied, e.at); } };
  ctl = {
    monitoring, payment, search, reservation, rental, issue, charging, redistribution, incident, simulation,
    listeners: () => [monitoring, rental, charging, redistribution, parkingSensor],
    armTimers: () => { reservation.armSeeded(); charging.armSeeded(); redistribution.armSeeded(); },
  };
  return ctl;
}
