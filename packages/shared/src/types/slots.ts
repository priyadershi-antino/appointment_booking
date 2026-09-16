import type { LocationType } from '../enums/domain.js';

/**
 * A bookable start time. Instants are always ISO-8601 UTC strings on the wire; the
 * client formats them into `displayTimezone` and never does slot arithmetic itself.
 */
export interface SlotDto {
  /** ISO-8601 UTC instant the appointment starts. */
  startUtc: string;
  /** ISO-8601 UTC instant the appointment ends (start + duration, buffers excluded). */
  endUtc: string;
  /** Resolved provider — meaningful when the caller asked for "any provider". */
  providerId: string;
  providerName: string;
}

export interface SlotDayDto {
  /** Calendar date in the display timezone, `yyyy-MM-dd`. */
  date: string;
  slots: SlotDto[];
}

export interface SlotQueryResultDto {
  serviceId: string;
  serviceName: string;
  durationMin: number;
  displayTimezone: string;
  /** The timezone the provider's working hours are defined in. */
  providerTimezone: string;
  locationType: LocationType;
  days: SlotDayDto[];
}

/** Lightweight response powering the calendar's enabled/disabled days. */
export interface AvailableDatesDto {
  displayTimezone: string;
  /** `yyyy-MM-dd` dates with at least one bookable slot. */
  dates: string[];
}
