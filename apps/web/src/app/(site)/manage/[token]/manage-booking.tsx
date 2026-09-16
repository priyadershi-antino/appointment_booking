'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarX2, CheckCircle2, MapPin, User } from 'lucide-react';
import {
  api,
  ApiRequestError,
  browserTimezone,
  formatDateLong,
  formatTime,
  type Appointment,
  type Slot,
  type SlotsResponse,
} from '@/lib/api';
import {
  currencyFormat,
  Dialog,
  ErrorState,
  SlotSkeleton,
  StatusBadge,
  useToast,
} from '@/components/ui';

interface Payload {
  appointment: Appointment;
  serviceId: string;
  providerId: string;
  cancellationPolicy: {
    description: string;
    allowCancellation: boolean;
    cancellationDeadlineMin: number;
    allowReschedule: boolean;
    rescheduleDeadlineMin: number;
  } | null;
  history: { action: string; at: string; actorType: string }[];
}

const REASONS = [
  { code: 'SCHEDULE_CONFLICT', label: 'Schedule conflict' },
  { code: 'NO_LONGER_NEEDED', label: 'No longer needed' },
  { code: 'BOOKED_BY_MISTAKE', label: 'Booked by mistake' },
  { code: 'OTHER', label: 'Something else' },
];

const dateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Guest booking management.
 *
 * Reached through the single-use token in the confirmation email — never through the
 * appointment id, which would let anyone enumerate other people's bookings. Deadlines are
 * shown here for honesty, but they are enforced by the API: a customer who waits past the
 * cancellation window gets a clear refusal from the server, not a hidden button.
 */
export function ManageBooking({ token }: { token: string }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('SCHEDULE_CONFLICT');
  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);

  const [rescheduling, setRescheduling] = useState(false);
  const [slotDate, setSlotDate] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [chosen, setChosen] = useState<Slot | null>(null);

  useEffect(() => setTimezone(browserTimezone()), []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setData(await api<Payload>(`/appointments/token/${token}`));
      setState('ready');
    } catch (error) {
      setMessage(
        error instanceof ApiRequestError
          ? error.error.message
          : 'This link is no longer valid. Please check your confirmation email.',
      );
      setState('error');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!rescheduling || !slotDate || !data) return;
    let cancelled = false;
    setSlotsLoading(true);
    setChosen(null);

    const params = new URLSearchParams({
      serviceId: data.serviceId,
      providerId: data.providerId,
      from: slotDate,
      to: slotDate,
      timezone,
    });

    api<SlotsResponse>(`/availability/slots?${params.toString()}`)
      .then((response) => !cancelled && setSlots(response.days[0]?.slots ?? []))
      .catch(() => !cancelled && setSlots([]))
      .finally(() => !cancelled && setSlotsLoading(false));

    return () => {
      cancelled = true;
    };
  }, [rescheduling, slotDate, data, timezone]);

  async function cancel() {
    setBusy(true);
    try {
      await api(`/appointments/${data!.appointment.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ token, reasonCode: reason, reason: freeText || undefined }),
      });
      toast('success', 'Your appointment has been cancelled.');
      setCancelOpen(false);
      await load();
    } catch (error) {
      toast(
        'error',
        error instanceof ApiRequestError ? error.error.message : 'We could not cancel that.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!chosen) return;
    setBusy(true);
    try {
      const result = await api<{ appointment: Appointment; manageToken: string }>(
        `/appointments/${data!.appointment.id}/reschedule`,
        { method: 'POST', body: JSON.stringify({ token, startsAt: chosen.startUtc }) },
      );
      toast('success', 'Your appointment has been moved.');
      // Rescheduling issues a fresh token, because the old appointment is now retired.
      window.location.href = `/manage/${result.manageToken}`;
    } catch (error) {
      toast(
        'error',
        error instanceof ApiRequestError ? error.error.message : 'We could not move that.',
      );
      if (error instanceof ApiRequestError && error.error.code === 'SLOT_UNAVAILABLE') {
        setChosen(null);
        setSlotDate((current) => current);
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="skeleton h-72" />
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState message={message} onRetry={() => void load()} />
      </div>
    );
  }

  const { appointment, cancellationPolicy } = data;
  const isLive = appointment.status === 'CONFIRMED' || appointment.status === 'PENDING';

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p className="eyebrow">Booking {appointment.code}</p>
      <h1 className="h1 mt-2">Your appointment</h1>

      <div className="card mt-6 overflow-hidden">
        <div className="border-b border-[var(--color-line)] bg-[var(--color-sunken)] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-lg font-bold">{appointment.serviceName}</p>
            <StatusBadge status={appointment.status} />
          </div>
        </div>

        <div className="p-5">
          <p className="text-3xl font-extrabold tracking-[-0.02em] tabular">
            {formatTime(appointment.startsAt, timezone)}
          </p>
          <p className="mt-1 font-semibold text-[var(--color-ink-muted)]">
            {formatDateLong(appointment.startsAt, timezone)}
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">Times shown in {timezone}</p>

          <dl className="mt-5 space-y-3 border-t border-[var(--color-line)] pt-5 text-sm">
            <Line icon={<CalendarClock size={14} />} label="Duration">
              {appointment.durationMin} minutes
            </Line>
            <Line icon={<User size={14} />} label="With">
              {appointment.providerName}
            </Line>
            <Line icon={<MapPin size={14} />} label="Where">
              {appointment.locationDetail ?? 'Online'}
            </Line>
            <Line label="Price">
              {currencyFormat(appointment.priceMinor, appointment.currency)}
            </Line>
          </dl>
        </div>

        {isLive ? (
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setRescheduling((open) => !open);
                if (!slotDate) setSlotDate(dateKey(new Date(Date.now() + 86_400_000)));
              }}
            >
              <CalendarClock size={15} />
              Reschedule
            </button>
            <button type="button" className="btn-ghost" onClick={() => setCancelOpen(true)}>
              <CalendarX2 size={15} />
              Cancel appointment
            </button>
          </div>
        ) : null}
      </div>

      {cancellationPolicy ? (
        <p className="mt-3 text-xs text-[var(--color-ink-subtle)]">
          {cancellationPolicy.description}
        </p>
      ) : null}

      {rescheduling && isLive ? (
        <section className="card animate-rise mt-6 p-5">
          <h2 className="h3">Pick a new time</h2>
          <div className="mt-3">
            <label className="label" htmlFor="new-date">
              Date
            </label>
            <input
              id="new-date"
              type="date"
              className="field max-w-xs"
              value={slotDate}
              min={dateKey(new Date())}
              onChange={(event) => setSlotDate(event.target.value)}
            />
          </div>

          <div className="mt-4">
            {slotsLoading ? (
              <SlotSkeleton />
            ) : slots.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
                No times available on that date. Try another day.
              </p>
            ) : (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto scroll-slim pr-1 sm:grid-cols-4">
                {slots.map((slot) => {
                  const selected = chosen?.startUtc === slot.startUtc;
                  return (
                    <button
                      key={slot.startUtc}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setChosen(slot)}
                      className={[
                        'h-10 rounded-[var(--radius-sm)] border text-sm font-bold tabular transition-all',
                        selected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                          : 'border-[var(--color-line-strong)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]',
                      ].join(' ')}
                    >
                      {formatTime(slot.startUtc, timezone)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {chosen ? (
            <button
              type="button"
              className="btn-primary mt-4 w-full"
              disabled={busy}
              onClick={() => void reschedule()}
            >
              {busy ? 'Moving…' : `Move to ${formatTime(chosen.startUtc, timezone)}`}
            </button>
          ) : null}
        </section>
      ) : null}

      {data.history.length > 0 ? (
        <section className="mt-8">
          <h2 className="h3 mb-3">History</h2>
          <ol className="card divide-y divide-[var(--color-line)]">
            {data.history.map((entry, index) => (
              <li key={index} className="flex items-center gap-3 p-3.5">
                <CheckCircle2 size={15} className="shrink-0 text-[var(--color-ink-subtle)]" />
                <span className="text-sm font-medium capitalize">
                  {entry.action.replace('_', ' ').toLowerCase()}
                </span>
                <span className="ml-auto text-xs tabular text-[var(--color-ink-subtle)]">
                  {new Date(entry.at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this appointment?"
        description={cancellationPolicy?.description}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCancelOpen(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => void cancel()}
            >
              {busy ? 'Cancelling…' : 'Cancel appointment'}
            </button>
          </>
        }
      >
        <fieldset>
          <legend className="label">Why are you cancelling?</legend>
          <div className="space-y-2">
            {REASONS.map((option) => (
              <label
                key={option.code}
                className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2.5 text-sm hover:bg-[var(--color-sunken)]"
              >
                <input
                  type="radio"
                  name="reason"
                  value={option.code}
                  checked={reason === option.code}
                  onChange={() => setReason(option.code)}
                  className="accent-[var(--color-accent)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {reason === 'OTHER' ? (
          <div className="mt-3">
            <label className="label" htmlFor="freetext">
              Tell us more <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              id="freetext"
              className="field h-20 resize-none py-2"
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function Line({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 text-[var(--color-ink-subtle)]">
        {icon}
        {label}
      </dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}
