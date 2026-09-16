'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, formatTime, type Appointment } from '@/lib/api';
import {
  currencyFormat,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatusBadge,
} from '@/components/ui';

type View = 'day' | 'week' | 'month';

interface Row extends Appointment {
  customer: { name: string; email: string; phone: string | null };
}

const dateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfWeek = (date: Date): Date => addDays(date, -date.getDay());

/**
 * Provider calendar.
 *
 * Deliberately not a grid of positioned blocks. At a clinic's density, a day-column list
 * ordered by time is easier to scan and far easier to make accessible than absolutely
 * positioned events, and it degrades to a single column on a phone without a rewrite.
 */
export default function CalendarPage() {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor, days: [anchor] };
    if (view === 'week') {
      const start = startOfWeek(anchor);
      const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
      return { from: start, to: addDays(start, 6), days };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const gridStart = startOfWeek(first);
    const cells = Math.ceil((last.getDate() + first.getDay()) / 7) * 7;
    return {
      from: gridStart,
      to: addDays(gridStart, cells - 1),
      days: Array.from({ length: cells }, (_, index) => addDays(gridStart, index)),
    };
  }, [view, anchor]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const params = new URLSearchParams({
        from: dateKey(range.from),
        to: dateKey(range.to),
        pageSize: '100',
      });
      setRows(await api<Row[]>(`/appointments?${params.toString()}`));
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load the calendar.');
      setState('error');
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const key = dateKey(new Date(row.startsAt));
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [rows]);

  const step = (direction: 1 | -1) => {
    if (view === 'day') setAnchor((current) => addDays(current, direction));
    else if (view === 'week') setAnchor((current) => addDays(current, 7 * direction));
    else
      setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  };

  const heading =
    view === 'month'
      ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : view === 'day'
        ? anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
        : `${range.from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${range.to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const today = dateKey(new Date());

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Appointments across your practice."
        actions={
          <SegmentedControl<View>
            ariaLabel="Calendar view"
            options={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
            value={view}
            onChange={setView}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary h-9 w-9 p-0"
          aria-label="Previous"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="btn-secondary h-9 w-9 p-0"
          aria-label="Next"
          onClick={() => step(1)}
        >
          <ChevronRight size={16} />
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setAnchor(new Date())}>
          Today
        </button>
        <h2 className="h3 ml-1">{heading}</h2>
      </div>

      {state === 'error' ? (
        <ErrorState message={message} onRetry={() => void load()} />
      ) : state === 'loading' ? (
        <Skeleton className="h-96" />
      ) : view === 'month' ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[var(--color-line)] bg-[var(--color-sunken)]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="th text-center">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {range.days.map((day) => {
              const key = dateKey(day);
              const items = byDay.get(key) ?? [];
              const outside = day.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={key}
                  className={[
                    'min-h-24 border-b border-r border-[var(--color-line)] p-1.5',
                    outside ? 'bg-[var(--color-canvas)]' : '',
                  ].join(' ')}
                >
                  <p
                    className={[
                      'mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular',
                      key === today
                        ? 'bg-[var(--color-accent)] text-white'
                        : outside
                          ? 'text-[var(--color-ink-subtle)]'
                          : '',
                    ].join(' ')}
                  >
                    {day.getDate()}
                  </p>
                  <div className="space-y-1">
                    {items.slice(0, 3).map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => setSelected(row)}
                        className="block w-full truncate rounded-[var(--radius-xs)] bg-[var(--color-accent-soft)] px-1.5 py-1 text-left text-[11px] font-semibold text-[var(--color-accent)] hover:brightness-95"
                      >
                        {formatTime(row.startsAt, row.timezone)} {row.customer?.name}
                      </button>
                    ))}
                    {items.length > 3 ? (
                      <p className="px-1.5 text-[11px] text-[var(--color-ink-subtle)]">
                        +{items.length - 3} more
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className={[
            'grid gap-3',
            view === 'day' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-7',
          ].join(' ')}
        >
          {range.days.map((day) => {
            const key = dateKey(day);
            const items = byDay.get(key) ?? [];
            return (
              <div key={key} className="card flex flex-col p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink-subtle)]">
                    {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                  </p>
                  <span
                    className={[
                      'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular',
                      key === today ? 'bg-[var(--color-accent)] text-white' : '',
                    ].join(' ')}
                  >
                    {day.getDate()}
                  </span>
                </div>

                {items.length === 0 ? (
                  <p className="py-4 text-center text-xs text-[var(--color-ink-subtle)]">
                    Nothing booked
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {items.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(row)}
                          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                        >
                          <p className="text-xs font-bold tabular">
                            {formatTime(row.startsAt, row.timezone)}
                          </p>
                          <p className="mt-0.5 truncate text-[13px] font-semibold">
                            {row.customer?.name}
                          </p>
                          <p className="truncate text-[11px] text-[var(--color-ink-subtle)]">
                            {row.serviceName}
                          </p>
                          <div className="mt-1.5">
                            <StatusBadge status={row.status} />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {state === 'ready' && rows.length === 0 && view !== 'month' ? (
        <div className="card mt-4">
          <EmptyState
            icon={<CalendarDays size={20} />}
            title="Nothing in this period"
            description="Move to another week or month, or wait for bookings to come in."
          />
        </div>
      ) : null}

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.serviceName ?? ''}
        description={selected?.code}
        footer={
          <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
            Close
          </button>
        }
      >
        {selected ? (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-subtle)]">Status</dt>
              <dd>
                <StatusBadge status={selected.status} />
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-subtle)]">When</dt>
              <dd className="text-right font-semibold">
                {new Date(selected.startsAt).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'long',
                })}
                <br />
                {formatTime(selected.startsAt, selected.timezone)} –{' '}
                {formatTime(selected.endsAt, selected.timezone)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-subtle)]">Customer</dt>
              <dd className="text-right font-semibold">
                {selected.customer?.name}
                <br />
                <span className="font-normal text-[var(--color-ink-muted)]">
                  {selected.customer?.email}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-subtle)]">Provider</dt>
              <dd className="font-semibold">{selected.providerName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-subtle)]">Price</dt>
              <dd className="font-semibold tabular">
                {currencyFormat(selected.priceMinor, selected.currency)}
              </dd>
            </div>
            {selected.notes ? (
              <div className="border-t border-[var(--color-line)] pt-3">
                <dt className="text-[var(--color-ink-subtle)]">Notes</dt>
                <dd className="mt-1">{selected.notes}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Dialog>
    </>
  );
}
