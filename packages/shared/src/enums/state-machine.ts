import { ActorType, AppointmentStatus } from './appointment.js';

/**
 * The legal transition table. Every status change in the system is routed through a
 * single guarded function that consults this table — no code path assigns a status
 * directly. `actors` lists who may perform the transition; SYSTEM covers sweepers,
 * webhooks and scheduled jobs.
 */
export interface TransitionRule {
  readonly from: AppointmentStatus;
  readonly to: AppointmentStatus;
  readonly actors: readonly ActorType[];
}

const ANYONE = [ActorType.CUSTOMER, ActorType.PROVIDER, ActorType.ADMIN, ActorType.SYSTEM] as const;
const STAFF = [ActorType.PROVIDER, ActorType.ADMIN] as const;

export const TRANSITIONS: readonly TransitionRule[] = [
  // A pending booking is awaiting payment or manual approval.
  { from: AppointmentStatus.PENDING, to: AppointmentStatus.CONFIRMED, actors: [ActorType.ADMIN, ActorType.PROVIDER, ActorType.SYSTEM] },
  { from: AppointmentStatus.PENDING, to: AppointmentStatus.CANCELLED, actors: ANYONE },

  // A confirmed booking can run its course, move, or fall away.
  { from: AppointmentStatus.CONFIRMED, to: AppointmentStatus.CANCELLED, actors: ANYONE },
  { from: AppointmentStatus.CONFIRMED, to: AppointmentStatus.RESCHEDULED, actors: ANYONE },
  { from: AppointmentStatus.CONFIRMED, to: AppointmentStatus.COMPLETED, actors: [...STAFF, ActorType.SYSTEM] },
  { from: AppointmentStatus.CONFIRMED, to: AppointmentStatus.NO_SHOW, actors: STAFF },
];

/** CANCELLED, COMPLETED, NO_SHOW and RESCHEDULED are terminal — nothing leaves them. */
export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.to === to);
}

export function canActorTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
  actor: ActorType,
): boolean {
  return TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.actors.includes(actor),
  );
}

export function allowedTransitions(from: AppointmentStatus, actor?: ActorType): AppointmentStatus[] {
  return TRANSITIONS.filter(
    (rule) => rule.from === from && (actor === undefined || rule.actors.includes(actor)),
  ).map((rule) => rule.to);
}
