'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import {
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  useToast,
} from '@/components/ui';
import { useSession } from '@/components/session';

interface Provider {
  id: string;
  name: string;
  title: string | null;
  timezone: string;
}

interface Window {
  startMinute: number;
  endMinute: number;
}

interface TimeOff {
  id: string;
  type: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  reason: string | null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const toHHMM = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const toMinutes = (value: string): number => {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Weekly working hours editor.
 *
 * Hours are edited as local wall-clock times in the provider's own timezone, because that
 * is how a person thinks about their week — "I work nine to five" is a statement about
 * local time, not about a UTC offset. The server stores exactly that and resolves it per
 * date, which is what keeps daylight-saving transitions correct.
 */
export default function AvailabilityPage() {
  const toast = useToast();
  const { user } = useSession();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState<string>('');
  const [timezone, setTimezone] = useState('');
  const [week, setWeek] = useState<Window[][]>(() => Array.from({ length: 7 }, () => []));
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [addingLeave, setAddingLeave] = useState(false);
  const [leave, setLeave] = useState({ type: 'VACATION', start: '', end: '', reason: '' });

  useEffect(() => {
    api<Provider[]>('/providers')
      .then((list) => {
        setProviders(list);
        // A provider lands on their own calendar; an admin on the first in the list.
        setProviderId(user?.providerId ?? list[0]?.id ?? '');
      })
      .catch(() => setProviders([]));
  }, [user?.providerId]);

  const load = useCallback(async () => {
    if (!providerId) return;
    setState('loading');
    try {
      const data = await api<{
        timezone: string;
        rules: { weekday: number; startMinute: number; endMinute: number }[];
        timeOff: TimeOff[];
      }>(`/providers/${providerId}/availability`);

      const grid: Window[][] = Array.from({ length: 7 }, () => []);
      for (const rule of data.rules) {
        grid[rule.weekday]?.push({ startMinute: rule.startMinute, endMinute: rule.endMinute });
      }
      for (const day of grid) day.sort((a, b) => a.startMinute - b.startMinute);

      setWeek(grid);
      setTimezone(data.timezone);
      setTimeOff(data.timeOff);
      setDirty(false);
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load availability.');
      setState('error');
    }
  }, [providerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = (next: Window[][]) => {
    setWeek(next);
    setDirty(true);
  };

  const addWindow = (day: number) => {
    const next = week.map((windows) => [...windows]);
    const last = next[day]!.at(-1);
    // Append after the last window rather than overlapping it.
    const start = last ? Math.min(last.endMinute + 60, 22 * 60) : 9 * 60;
    next[day]!.push({ startMinute: start, endMinute: Math.min(start + 240, 24 * 60) });
    mutate(next);
  };

  const removeWindow = (day: number, index: number) => {
    const next = week.map((windows) => [...windows]);
    next[day]!.splice(index, 1);
    mutate(next);
  };

  const editWindow = (day: number, index: number, field: keyof Window, value: string) => {
    const next = week.map((windows) => windows.map((window) => ({ ...window })));
    next[day]![index]![field] = toMinutes(value);
    mutate(next);
  };

  const copyToAll = (source: number) => {
    const next = week.map((_, day) =>
      // Weekends are left alone: copying Monday onto Saturday is almost never intended.
      day === 0 || day === 6 ? week[day]!.map((w) => ({ ...w })) : week[source]!.map((w) => ({ ...w })),
    );
    mutate(next);
    setCopyFrom(null);
    toast('info', `Copied ${DAYS[source]} to every weekday. Save to apply.`);
  };

  async function save() {
    // Catch overlaps here rather than letting the engine silently merge them, so the
    // person editing sees the problem where they made it.
    for (let day = 0; day < 7; day += 1) {
      const windows = [...week[day]!].sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 0; i < windows.length; i += 1) {
        if (windows[i]!.endMinute <= windows[i]!.startMinute) {
          toast('error', `${DAYS[day]}: a window must end after it starts.`);
          return;
        }
        if (i > 0 && windows[i]!.startMinute < windows[i - 1]!.endMinute) {
          toast('error', `${DAYS[day]}: those windows overlap.`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const rules = week.flatMap((windows, weekday) =>
        windows.map((window) => ({
          weekday,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
        })),
      );
      await api(`/providers/${providerId}/availability`, {
        method: 'PUT',
        body: JSON.stringify({ rules }),
      });
      toast('success', 'Working hours updated. New slots reflect this immediately.');
      setDirty(false);
    } catch (error) {
      toast('error', error instanceof ApiRequestError ? error.error.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function addTimeOff() {
    if (!leave.start || !leave.end) {
      toast('error', 'Pick a start and end.');
      return;
    }
    setSaving(true);
    try {
      await api(`/providers/${providerId}/time-off`, {
        method: 'POST',
        body: JSON.stringify({
          type: leave.type,
          startsAt: new Date(leave.start).toISOString(),
          endsAt: new Date(leave.end).toISOString(),
          isAllDay: false,
          reason: leave.reason || undefined,
        }),
      });
      toast('success', 'Time off added. Those slots have disappeared from booking.');
      setAddingLeave(false);
      setLeave({ type: 'VACATION', start: '', end: '', reason: '' });
      await load();
    } catch (error) {
      toast('error', error instanceof ApiRequestError ? error.error.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function removeTimeOff(id: string) {
    try {
      await api(`/time-off/${id}`, { method: 'DELETE' });
      toast('success', 'Time off removed.');
      await load();
    } catch (error) {
      toast('error', error instanceof ApiRequestError ? error.error.message : 'Could not remove.');
    }
  }

  return (
    <>
      <PageHeader
        title="Availability"
        description="Recurring weekly hours and time off. Slots are generated from these."
        actions={
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="provider">
            Provider
          </label>
          <select
            id="provider"
            className="field"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            disabled={Boolean(user?.providerId) && user?.role !== 'ADMIN'}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
                {provider.title ? ` — ${provider.title}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="label">Timezone</p>
          <p className="flex h-10 items-center text-sm font-semibold">{timezone || '—'}</p>
        </div>
      </div>

      {state === 'error' ? (
        <ErrorState message={message} onRetry={() => void load()} />
      ) : state === 'loading' ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="card divide-y divide-[var(--color-line)]">
            {DAYS.map((label, day) => {
              const windows = week[day]!;
              return (
                <div key={label} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <div className="flex w-36 shrink-0 items-center justify-between sm:block">
                    <p className="font-bold">{label}</p>
                    {windows.length === 0 ? (
                      <p className="text-xs text-[var(--color-ink-subtle)]">Unavailable</p>
                    ) : null}
                  </div>

                  <div className="flex-1 space-y-2">
                    {windows.map((window, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-2">
                        <input
                          type="time"
                          className="field w-32"
                          value={toHHMM(window.startMinute)}
                          step={900}
                          aria-label={`${label} window ${index + 1} start`}
                          onChange={(event) =>
                            editWindow(day, index, 'startMinute', event.target.value)
                          }
                        />
                        <span className="text-[var(--color-ink-subtle)]">to</span>
                        <input
                          type="time"
                          className="field w-32"
                          value={toHHMM(window.endMinute)}
                          step={900}
                          aria-label={`${label} window ${index + 1} end`}
                          onChange={(event) =>
                            editWindow(day, index, 'endMinute', event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="btn-ghost h-9 w-9 p-0 text-[var(--color-danger)]"
                          aria-label={`Remove ${label} window ${index + 1}`}
                          onClick={() => removeWindow(day, index)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => addWindow(day)}
                      >
                        <Plus size={14} />
                        Add hours
                      </button>
                      {windows.length > 0 ? (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setCopyFrom(day)}
                        >
                          <Copy size={14} />
                          Copy to weekdays
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="h3">Time off</h2>
                <p className="text-xs text-[var(--color-ink-subtle)]">
                  Holidays, leave and blocked periods. These disappear from booking immediately.
                </p>
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setAddingLeave(true)}>
                <Plus size={14} />
                Add
              </button>
            </div>

            {timeOff.length === 0 ? (
              <div className="card">
                <EmptyState
                  title="No time off scheduled"
                  description="Add vacation, leave or a blocked period and those slots stop being offered."
                />
              </div>
            ) : (
              <ul className="card divide-y divide-[var(--color-line)]">
                {timeOff.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold capitalize">
                        {entry.type.replace('_', ' ').toLowerCase()}
                        {entry.reason ? (
                          <span className="font-normal text-[var(--color-ink-muted)]">
                            {' '}
                            — {entry.reason}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs tabular text-[var(--color-ink-subtle)]">
                        {new Date(entry.startsAt).toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        →{' '}
                        {new Date(entry.endsAt).toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost h-9 w-9 shrink-0 p-0 text-[var(--color-danger)]"
                      aria-label="Remove time off"
                      onClick={() => void removeTimeOff(entry.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Dialog
        open={copyFrom !== null}
        onClose={() => setCopyFrom(null)}
        title={copyFrom !== null ? `Copy ${DAYS[copyFrom]} to every weekday?` : ''}
        description="Monday to Friday will be replaced with these hours. Saturday and Sunday are left alone."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCopyFrom(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              data-autofocus
              onClick={() => copyFrom !== null && copyToAll(copyFrom)}
            >
              Copy
            </button>
          </>
        }
      />

      <Dialog
        open={addingLeave}
        onClose={() => setAddingLeave(false)}
        title="Add time off"
        description="Existing appointments are not cancelled — only new bookings are prevented."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAddingLeave(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving}
              onClick={() => void addTimeOff()}
            >
              {saving ? 'Adding…' : 'Add time off'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="leave-type">
              Type
            </label>
            <select
              id="leave-type"
              className="field"
              data-autofocus
              value={leave.type}
              onChange={(event) => setLeave({ ...leave, type: event.target.value })}
            >
              {['VACATION', 'SICK_LEAVE', 'PERSONAL', 'HOLIDAY', 'BLOCKED'].map((type) => (
                <option key={type} value={type}>
                  {type.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="leave-start">
                Starts
              </label>
              <input
                id="leave-start"
                type="datetime-local"
                className="field"
                value={leave.start}
                onChange={(event) => setLeave({ ...leave, start: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="leave-end">
                Ends
              </label>
              <input
                id="leave-end"
                type="datetime-local"
                className="field"
                value={leave.end}
                onChange={(event) => setLeave({ ...leave, end: event.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="leave-reason">
              Reason <span className="font-normal normal-case">(optional)</span>
            </label>
            <input
              id="leave-reason"
              className="field"
              value={leave.reason}
              onChange={(event) => setLeave({ ...leave, reason: event.target.value })}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
