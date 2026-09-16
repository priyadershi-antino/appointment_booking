'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiRequestError, formatMoney, formatTime, type Appointment } from '@/lib/api';
import { EmptyState, ErrorState, Stat, StatusBadge } from '@/components/ui';

interface Summary {
  today: number;
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  cancellationRate: number;
  revenueMinor: number;
  averagePerDay: number;
  popularServices: { name: string; count: number }[];
}

/**
 * Admin overview.
 *
 * A client component deliberately. The session is an httpOnly cookie held by the browser,
 * so the request has to originate there — a server component would fetch with no cookie
 * attached and be permanently unauthenticated.
 *
 * It reads through the same API as everything else, with no privileged back channel, so
 * what it can show is exactly what the signed-in user is allowed to read.
 */
export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unauthenticated' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [summaryData, list] = await Promise.all([
        api<Summary>('/analytics/summary?days=30'),
        api<Appointment[]>('/appointments?pageSize=10'),
      ]);
      setSummary(summaryData);
      setAppointments(list);
      setState('ready');
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
        setState('unauthenticated');
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not load the dashboard.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'unauthenticated') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-black tracking-tight">Dashboard</h1>
        <div className="card mt-6">
          <EmptyState
            title="Sign in to continue"
            description="The dashboard shows appointments and analytics for your account."
            action={
              <Link href="/login" className="btn-primary">
                Sign in
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-black tracking-tight mb-6">Dashboard</h1>
        <ErrorState message={message} onRetry={() => void load()} />
      </div>
    );
  }

  if (state === 'loading' || !summary) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-black tracking-tight">Dashboard</h1>
        <div className="mt-6 grid gap-3 grid-cols-2 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="skeleton h-24" />
          ))}
        </div>
        <div className="skeleton h-64 mt-10" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Last 30 days</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="mt-6 grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Today" value={String(summary.today)} hint="upcoming appointments" />
        <Stat label="Confirmed" value={String(summary.confirmed)} />
        <Stat label="Completed" value={String(summary.completed)} />
        <Stat
          label="Cancelled"
          value={String(summary.cancelled)}
          hint={`${summary.cancellationRate}% cancellation rate`}
        />
        <Stat label="No shows" value={String(summary.noShow)} />
        <Stat
          label="Revenue"
          value={formatMoney(summary.revenueMinor, 'INR')}
          hint="completed only"
        />
        <Stat label="Avg / day" value={String(summary.averagePerDay)} />
        <Stat label="Total" value={String(summary.total)} hint="all statuses" />
      </div>

      <section className="mt-10">
        <h2 className="font-bold mb-3">Recent appointments</h2>
        {appointments.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No appointments found"
              description="Nothing has been booked yet. New bookings appear here as they come in."
            />
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left">
                  {['Reference', 'Service', 'Provider', 'When', 'Status', 'Price'].map((head) => (
                    <th
                      key={head}
                      className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)] whitespace-nowrap"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appointments.map((appointment) => (
                  <tr
                    key={appointment.id}
                    className="border-b border-[var(--color-line-soft)] last:border-0"
                  >
                    <td className="px-4 py-3 font-bold tabular-nums whitespace-nowrap">
                      {appointment.code}
                    </td>
                    <td className="px-4 py-3">{appointment.serviceName}</td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)] whitespace-nowrap">
                      {appointment.providerName}
                    </td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                      {new Date(appointment.startsAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                      })}{' '}
                      {formatTime(appointment.startsAt, appointment.timezone)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={appointment.status} />
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums whitespace-nowrap">
                      {formatMoney(appointment.priceMinor, appointment.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {summary.popularServices.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-bold mb-3">Popular services</h2>
          <div className="card p-5 space-y-3">
            {summary.popularServices.map((service) => {
              const max = summary.popularServices[0]?.count || 1;
              return (
                <div key={service.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold">{service.name}</span>
                    <span className="tabular-nums text-[var(--color-ink-muted)]">
                      {service.count}
                    </span>
                  </div>
                  <div className="h-2 bg-[var(--color-surface-sunken)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)]"
                      style={{ width: `${(service.count / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
