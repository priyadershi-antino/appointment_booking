'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarX2, Check, Download, Search, SlidersHorizontal, UserX } from 'lucide-react';
import {
  api,
  apiBase,
  ApiRequestError,
  formatDateLong,
  formatTime,
  type Appointment,
} from '@/lib/api';
import {
  currencyFormat,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusBadge,
  TableSkeleton,
  useDebounced,
  useToast,
} from '@/components/ui';

interface Row extends Appointment {
  customer: { name: string; email: string; phone: string | null };
  providerId: string;
  serviceId: string;
  createdAt: string;
}

interface Meta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

const STATUSES = ['', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];

export default function AppointmentsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const debouncedSearch = useDebounced(search, 350);
  const [acting, setActing] = useState<{ row: Row; outcome: 'COMPLETED' | 'NO_SHOW' } | null>(null);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [page, debouncedSearch, status, from, to]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(
        `${apiBase()}/appointments?${queryString}`,
        { credentials: 'include', cache: 'no-store' },
      );
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body?.error?.message ?? 'Request failed');
      setRows(body.data);
      setMeta(body.meta);
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load appointments.');
      setState('error');
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change invalidates the current page number.
  useEffect(() => setPage(1), [debouncedSearch, status, from, to]);

  async function markOutcome() {
    if (!acting) return;
    setBusy(true);
    try {
      await api(`/appointments/${acting.row.id}/outcome`, {
        method: 'POST',
        body: JSON.stringify({ outcome: acting.outcome }),
      });
      toast('success', `Marked as ${acting.outcome === 'COMPLETED' ? 'completed' : 'no-show'}.`);
      setActing(null);
      await load();
    } catch (error) {
      toast('error', error instanceof ApiRequestError ? error.error.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      await api(`/appointments/${cancelling.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reasonCode: 'OTHER', reason: 'Cancelled by staff' }),
      });
      toast('success', 'Appointment cancelled. The slot is free again.');
      setCancelling(null);
      await load();
    } catch (error) {
      toast('error', error instanceof ApiRequestError ? error.error.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Exports what is currently on screen. Deliberately the visible page rather than the
   * whole table: an export that silently differs from the filters you applied is worse
   * than no export.
   */
  function exportCsv() {
    const header = [
      'Reference',
      'Status',
      'Service',
      'Provider',
      'Customer',
      'Email',
      'Phone',
      'Starts',
      'Duration (min)',
      'Price',
      'Currency',
    ];
    const escape = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((row) =>
      [
        row.code,
        row.status,
        row.serviceName,
        row.providerName,
        row.customer?.name,
        row.customer?.email,
        row.customer?.phone,
        row.startsAt,
        row.durationMin,
        (row.priceMinor / 100).toFixed(2),
        row.currency,
      ]
        .map(escape)
        .join(','),
    );

    const blob = new Blob([[header.map(escape).join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `appointments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast('success', `Exported ${rows.length} appointment${rows.length === 1 ? '' : 's'}.`);
  }

  const activeFilters = [status, from, to].filter(Boolean).length;

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Every booking, with its full lifecycle."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal size={14} />
              Filters
              {activeFilters > 0 ? (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-bold text-white">
                  {activeFilters}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={exportCsv}
              disabled={rows.length === 0}
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          </>
        }
      />

      <div className="card mb-4 p-3">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-subtle)]"
          />
          <input
            type="search"
            className="field pl-9"
            placeholder="Search reference, service, customer name or email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search appointments"
          />
        </div>

        {showFilters ? (
          <div className="animate-rise mt-3 grid gap-3 border-t border-[var(--color-line)] pt-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="status">
                Status
              </label>
              <select
                id="status"
                className="field"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {STATUSES.map((value) => (
                  <option key={value || 'all'} value={value}>
                    {value ? value.replace('_', ' ').toLowerCase() : 'All statuses'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="from">
                From
              </label>
              <input
                id="from"
                type="date"
                className="field"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="to">
                To
              </label>
              <input
                id="to"
                type="date"
                className="field"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            {activeFilters > 0 ? (
              <div className="sm:col-span-3">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setStatus('');
                    setFrom('');
                    setTo('');
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {state === 'error' ? (
        <ErrorState message={message} onRetry={() => void load()} />
      ) : state === 'loading' ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CalendarX2 size={20} />}
            title="No appointments found"
            description={
              activeFilters > 0 || search
                ? 'Nothing matches these filters. Try widening the date range or clearing the search.'
                : 'Nothing has been booked yet. New appointments will appear here.'
            }
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full">
              <thead className="bg-[var(--color-sunken)]">
                <tr>
                  <th className="th">Reference</th>
                  <th className="th">Customer</th>
                  <th className="th">Service</th>
                  <th className="th">Provider</th>
                  <th className="th">When</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Price</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="row">
                    <td className="td font-bold tabular whitespace-nowrap">{row.code}</td>
                    <td className="td">
                      <p className="font-semibold">{row.customer?.name}</p>
                      <p className="text-xs text-[var(--color-ink-subtle)]">{row.customer?.email}</p>
                    </td>
                    <td className="td">{row.serviceName}</td>
                    <td className="td text-[var(--color-ink-muted)]">{row.providerName}</td>
                    <td className="td tabular whitespace-nowrap">
                      {new Date(row.startsAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: '2-digit',
                      })}
                      <span className="ml-2 text-[var(--color-ink-muted)]">
                        {formatTime(row.startsAt, row.timezone)}
                      </span>
                    </td>
                    <td className="td">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="td tabular text-right font-semibold whitespace-nowrap">
                      {currencyFormat(row.priceMinor, row.currency)}
                    </td>
                    <td className="td">
                      {row.status === 'CONFIRMED' ? (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Mark completed"
                            aria-label={`Mark ${row.code} completed`}
                            className="btn-ghost h-8 w-8 p-0"
                            onClick={() => setActing({ row, outcome: 'COMPLETED' })}
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            title="Mark no-show"
                            aria-label={`Mark ${row.code} as no-show`}
                            className="btn-ghost h-8 w-8 p-0"
                            onClick={() => setActing({ row, outcome: 'NO_SHOW' })}
                          >
                            <UserX size={15} />
                          </button>
                          <button
                            type="button"
                            title="Cancel"
                            aria-label={`Cancel ${row.code}`}
                            className="btn-ghost h-8 w-8 p-0 text-[var(--color-danger)]"
                            onClick={() => setCancelling(row)}
                          >
                            <CalendarX2 size={15} />
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta ? (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3">
              <p className="text-xs text-[var(--color-ink-muted)]">
                Page <span className="font-bold tabular">{meta.page}</span> of{' '}
                <span className="font-bold tabular">{Math.max(1, meta.totalPages)}</span> ·{' '}
                <span className="font-bold tabular">{meta.total}</span> total
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!meta.hasPrevious}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!meta.hasNext}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <Dialog
        open={acting !== null}
        onClose={() => setActing(null)}
        title={acting?.outcome === 'COMPLETED' ? 'Mark as completed' : 'Mark as no-show'}
        description={
          acting
            ? `${acting.row.customer?.name} · ${acting.row.serviceName} · ${formatDateLong(
                acting.row.startsAt,
                acting.row.timezone,
              )}`
            : undefined
        }
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setActing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              data-autofocus
              disabled={busy}
              onClick={() => void markOutcome()}
            >
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-ink-muted)]">
          This is recorded in the appointment history and cannot be undone.
        </p>
      </Dialog>

      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancel this appointment?"
        description={
          cancelling
            ? `${cancelling.customer?.name} · ${cancelling.serviceName} · ${formatDateLong(
                cancelling.startsAt,
                cancelling.timezone,
              )}`
            : undefined
        }
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCancelling(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn-danger"
              data-autofocus
              disabled={busy}
              onClick={() => void cancel()}
            >
              {busy ? 'Cancelling…' : 'Cancel appointment'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-ink-muted)]">
          The slot becomes available to other customers immediately. Staff cancellations are not
          subject to the customer cancellation deadline.
        </p>
      </Dialog>
    </>
  );
}
