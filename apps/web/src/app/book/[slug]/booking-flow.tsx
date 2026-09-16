'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiRequestError,
  browserTimezone,
  formatDateLong,
  formatMoney,
  formatTime,
  type Appointment,
  type ServiceSummary,
  type Slot,
  type SlotsResponse,
} from '@/lib/api';
import { EmptyState, ErrorState, SlotSkeleton } from '@/components/ui';

type Step = 'pick' | 'details' | 'done';

const dateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * The customer booking flow.
 *
 * Slot times are never computed here. The browser asks the API which dates have
 * availability and which times are bookable on a chosen date, and renders the answer.
 * That is the whole contract — anything else would let the UI offer a time the booking
 * engine would then refuse.
 */
export function BookingFlow({ service }: { service: ServiceSummary }) {
  const [timezone, setTimezone] = useState<string>('Asia/Kolkata');
  const [providerId, setProviderId] = useState<string>('');
  const [month, setMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [datesLoading, setDatesLoading] = useState(true);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('pick');
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ appointment: Appointment; manageToken: string } | null>(
    null,
  );

  // Detected on the client only, so server and client markup agree on first paint.
  useEffect(() => setTimezone(browserTimezone()), []);

  const query = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams({ serviceId: service.id, from, to, timezone });
      if (providerId) params.set('providerId', providerId);
      return params.toString();
    },
    [service.id, providerId, timezone],
  );

  const monthBounds = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const today = new Date();
    // Never ask about dates already past.
    return { from: dateKey(first > today ? first : today), to: dateKey(last), first, last };
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    setDatesLoading(true);
    setLoadError(null);

    api<{ dates: string[] }>(`/availability/dates?${query(monthBounds.from, monthBounds.to)}`)
      .then((data) => {
        if (cancelled) return;
        setAvailableDates(new Set(data.dates));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load availability.');
      })
      .finally(() => !cancelled && setDatesLoading(false));

    return () => {
      cancelled = true;
    };
  }, [query, monthBounds.from, monthBounds.to]);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSelectedSlot(null);

    api<SlotsResponse>(`/availability/slots?${query(selectedDate, selectedDate)}`)
      .then((data) => {
        if (cancelled) return;
        setSlots(data.days[0]?.slots ?? []);
      })
      .catch(() => !cancelled && setSlots([]))
      .finally(() => !cancelled && setSlotsLoading(false));

    return () => {
      cancelled = true;
    };
  }, [selectedDate, query]);

  const calendarCells = useMemo(() => {
    const cells: (string | null)[] = [];
    const leading = monthBounds.first.getDay();
    for (let i = 0; i < leading; i += 1) cells.push(null);
    for (let day = 1; day <= monthBounds.last.getDate(); day += 1) {
      cells.push(dateKey(new Date(month.getFullYear(), month.getMonth(), day)));
    }
    return cells;
  }, [month, monthBounds]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSlot) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await api<{ appointment: Appointment; manageToken: string }>('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: service.id,
          providerId: selectedSlot.providerId,
          startsAt: selectedSlot.startUtc,
          customer: {
            name: form.name,
            email: form.email,
            phone: form.phone || undefined,
            timezone,
          },
          notes: form.notes || undefined,
        }),
      });
      setConfirmed(result);
      setStep('done');
    } catch (error) {
      if (error instanceof ApiRequestError && error.error.code === 'SLOT_UNAVAILABLE') {
        // Someone else took it while this form was open. Send them back to a fresh list
        // rather than leaving a dead selection on screen.
        setSubmitError(error.error.message);
        setSelectedSlot(null);
        setStep('pick');
        setSlotsLoading(true);
        api<SlotsResponse>(`/availability/slots?${query(selectedDate!, selectedDate!)}`)
          .then((data) => setSlots(data.days[0]?.slots ?? []))
          .finally(() => setSlotsLoading(false));
      } else {
        setSubmitError(
          error instanceof Error ? error.message : 'We could not complete your booking.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'done' && confirmed) {
    return <Confirmation result={confirmed} timezone={timezone} service={service} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="border-b border-[var(--color-line)] pb-6">
        <h1 className="text-3xl font-black tracking-tight">{service.name}</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)] max-w-2xl">{service.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
          <span className="tabular-nums">{service.durationMin} minutes</span>
          <span aria-hidden className="text-[var(--color-line-soft)]">
            ·
          </span>
          <span className="tabular-nums">{formatMoney(service.priceMinor, service.currency)}</span>
          <span aria-hidden className="text-[var(--color-line-soft)]">
            ·
          </span>
          <span>{service.locationType === 'ONLINE' ? 'Online' : service.locationDetail}</span>
        </div>
      </header>

      {submitError ? (
        <div className="mt-6">
          <ErrorState message={submitError} />
        </div>
      ) : null}

      {step === 'pick' ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Calendar */}
          <section aria-label="Choose a date">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold">Select a date</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn-secondary w-9 px-0"
                  aria-label="Previous month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                >
                  ‹
                </button>
                <span className="text-sm font-bold w-36 text-center">
                  {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  className="btn-secondary w-9 px-0"
                  aria-label="Next month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                >
                  ›
                </button>
              </div>
            </div>

            {loadError ? (
              <ErrorState message={loadError} onRetry={() => setMonth(new Date(month))} />
            ) : (
              <div className="card p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                    <div
                      key={day}
                      className="text-center text-[11px] font-bold uppercase text-[var(--color-ink-subtle)] py-1"
                    >
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarCells.map((key, index) => {
                    if (!key) return <div key={`pad-${index}`} />;
                    const available = availableDates.has(key);
                    const isSelected = key === selectedDate;
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!available || datesLoading}
                        aria-pressed={isSelected}
                        aria-label={`${key}${available ? '' : ', no availability'}`}
                        onClick={() => setSelectedDate(key)}
                        className={[
                          'h-10 text-sm font-semibold tabular-nums rounded-[var(--radius-sharp)] border transition-colors',
                          isSelected
                            ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                            : available
                              ? 'bg-white border-[var(--color-line)] hover:bg-[var(--color-accent-soft)]'
                              : 'bg-[var(--color-surface-sunken)] border-transparent text-[var(--color-ink-subtle)] cursor-not-allowed',
                        ].join(' ')}
                      >
                        {Number(key.slice(8))}
                      </button>
                    );
                  })}
                </div>
                {datesLoading ? (
                  <p className="mt-3 text-xs text-[var(--color-ink-subtle)]">
                    Checking availability…
                  </p>
                ) : null}
              </div>
            )}

            {service.providers.length > 1 ? (
              <div className="mt-4">
                <label className="label" htmlFor="provider">
                  Practitioner
                </label>
                <select
                  id="provider"
                  className="field"
                  value={providerId}
                  onChange={(event) => {
                    setProviderId(event.target.value);
                    setSelectedDate(null);
                  }}
                >
                  <option value="">Any available</option>
                  {service.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.title ? ` — ${provider.title}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>

          {/* Times */}
          <section aria-label="Choose a time">
            <h2 className="font-bold mb-4">
              {selectedDate
                ? new Date(`${selectedDate}T12:00:00Z`).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })
                : 'Available times'}
            </h2>

            {!selectedDate ? (
              <div className="card">
                <EmptyState
                  title="Pick a date first"
                  description="Choose a highlighted day on the calendar to see the times available."
                />
              </div>
            ) : slotsLoading ? (
              <SlotSkeleton />
            ) : slots.length === 0 ? (
              <div className="card">
                <EmptyState
                  title="No times on this day"
                  description="Everything is booked or outside working hours. Try another date."
                />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
                  {slots.map((slot) => {
                    const chosen = selectedSlot?.startUtc === slot.startUtc;
                    return (
                      <button
                        key={slot.startUtc}
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => setSelectedSlot(slot)}
                        className={[
                          'h-10 text-sm font-bold tabular-nums rounded-[var(--radius-sharp)] border transition-colors',
                          chosen
                            ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                            : 'bg-white border-[var(--color-line)] hover:bg-[var(--color-accent-soft)]',
                        ].join(' ')}
                      >
                        {formatTime(slot.startUtc, timezone)}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-3 text-xs text-[var(--color-ink-subtle)]">
                  Times shown in <span className="font-semibold">{timezone}</span>
                </p>

                {selectedSlot ? (
                  <button
                    type="button"
                    className="btn-primary w-full mt-4"
                    onClick={() => setStep('details')}
                  >
                    Continue with {formatTime(selectedSlot.startUtc, timezone)}
                  </button>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}

      {step === 'details' && selectedSlot ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <h2 className="font-bold">Your details</h2>

            <div>
              <label className="label" htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                className="field"
                required
                minLength={2}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>

            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                required
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
              <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                Your confirmation and management link are sent here.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="phone">
                Phone <span className="font-normal normal-case">(optional)</span>
              </label>
              <input
                id="phone"
                className="field"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </div>

            <div>
              <label className="label" htmlFor="notes">
                Anything we should know? <span className="font-normal normal-case">(optional)</span>
              </label>
              <textarea
                id="notes"
                className="field h-24 py-2 resize-none"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setStep('pick')}>
                Back
              </button>
              <button type="submit" className="btn-primary flex-1" disabled={submitting}>
                {submitting ? 'Confirming…' : 'Confirm booking'}
              </button>
            </div>
          </form>

          <aside className="card p-5 h-fit">
            <h3 className="font-bold text-sm uppercase tracking-wide text-[var(--color-ink-muted)]">
              Your appointment
            </h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-[var(--color-ink-subtle)]">Service</dt>
                <dd className="font-bold">{service.name}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-subtle)]">When</dt>
                <dd className="font-bold">
                  {formatDateLong(selectedSlot.startUtc, timezone)}
                  <br />
                  {formatTime(selectedSlot.startUtc, timezone)} –{' '}
                  {formatTime(selectedSlot.endUtc, timezone)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-subtle)]">With</dt>
                <dd className="font-bold">{selectedSlot.providerName}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-ink-subtle)]">Price</dt>
                <dd className="font-bold tabular-nums">
                  {formatMoney(service.priceMinor, service.currency)}
                </dd>
              </div>
            </dl>

            {service.cancellationPolicy ? (
              <p className="mt-4 pt-4 border-t border-[var(--color-line-soft)] text-xs text-[var(--color-ink-muted)]">
                {service.cancellationPolicy.description}
              </p>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Confirmation({
  result,
  timezone,
  service,
}: {
  result: { appointment: Appointment; manageToken: string };
  timezone: string;
  service: ServiceSummary;
}) {
  const { appointment } = result;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-confirmed-soft)] text-[var(--color-confirmed)] text-2xl font-black">
        ✓
      </div>
      <h1 className="mt-5 text-3xl font-black tracking-tight">Appointment confirmed</h1>

      <div className="card mt-8 p-6 text-left">
        <p className="font-bold text-lg">{appointment.serviceName}</p>
        <p className="mt-3 text-2xl font-black tabular-nums">
          {formatTime(appointment.startsAt, timezone)}
        </p>
        <p className="text-sm font-semibold text-[var(--color-ink-muted)]">
          {formatDateLong(appointment.startsAt, timezone)}
        </p>

        <dl className="mt-5 pt-5 border-t border-[var(--color-line-soft)] space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-ink-subtle)]">Duration</dt>
            <dd className="font-semibold tabular-nums">{appointment.durationMin} minutes</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-ink-subtle)]">With</dt>
            <dd className="font-semibold">{appointment.providerName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-ink-subtle)]">Where</dt>
            <dd className="font-semibold text-right max-w-[60%]">
              {appointment.locationDetail ?? 'Online'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-ink-subtle)]">Booking reference</dt>
            <dd className="font-black tabular-nums">{appointment.code}</dd>
          </div>
        </dl>
      </div>

      <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
        A confirmation has been sent to your email with a link to reschedule or cancel.
      </p>
      {service.cancellationPolicy ? (
        <p className="mt-2 text-xs text-[var(--color-ink-subtle)]">
          {service.cancellationPolicy.description}
        </p>
      ) : null}

      <a className="btn-secondary mt-8" href="/">
        Book another appointment
      </a>
    </div>
  );
}
