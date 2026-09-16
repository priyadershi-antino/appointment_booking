'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarCheck, CalendarX, CheckCircle2, IndianRupee, TrendingUp, UserX } from 'lucide-react';
import { api, formatTime, type Appointment } from '@/lib/api';
import {
  currencyFormat,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Stat,
  StatusBadge,
} from '@/components/ui';

interface Summary {
  today: number;
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  pending: number;
  cancellationRate: number;
  revenueMinor: number;
  averagePerDay: number;
  popularServices: { name: string; count: number }[];
}

interface Point {
  date: string;
  booked: number;
  cancelled: number;
  revenue: number;
}

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;

const PIE_COLOURS = ['#4f2fe0', '#7c5cf0', '#a58dff', '#cbbcff', '#e6dfff'];

export default function DashboardPage() {
  const [days, setDays] = useState<string>('30');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [series, setSeries] = useState<Point[]>([]);
  const [recent, setRecent] = useState<Appointment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [summaryData, seriesData, list] = await Promise.all([
        api<Summary>(`/analytics/summary?days=${days}`),
        api<Point[]>(`/analytics/timeseries?days=${Math.max(7, Number(days))}`),
        api<Appointment[]>('/appointments?pageSize=6'),
      ]);
      setSummary(summaryData);
      setSeries(seriesData);
      setRecent(list);
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load the dashboard.');
      setState('error');
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'error') {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState message={message} onRetry={() => void load()} />
      </>
    );
  }

  const loading = state === 'loading' || !summary;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Bookings, outcomes and revenue across your practice."
        actions={
          <SegmentedControl
            ariaLabel="Date range"
            options={RANGES as unknown as { value: string; label: string }[]}
            value={days}
            onChange={setDays}
          />
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[104px]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Today"
            value={String(summary.today)}
            hint="upcoming"
            icon={<CalendarCheck size={14} />}
            accent="var(--color-accent-soft)"
          />
          <Stat label="Confirmed" value={String(summary.confirmed)} icon={<CheckCircle2 size={14} />} accent="var(--color-ok-soft)" />
          <Stat label="Completed" value={String(summary.completed)} icon={<CheckCircle2 size={14} />} accent="var(--color-info-soft)" />
          <Stat
            label="Cancelled"
            value={String(summary.cancelled)}
            hint={`${summary.cancellationRate}% of bookings`}
            icon={<CalendarX size={14} />}
            accent="var(--color-danger-soft)"
          />
          <Stat label="No shows" value={String(summary.noShow)} icon={<UserX size={14} />} accent="var(--color-neutral-soft)" />
          <Stat
            label="Revenue"
            value={currencyFormat(summary.revenueMinor, 'INR')}
            hint="completed only"
            icon={<IndianRupee size={14} />}
            accent="var(--color-ok-soft)"
          />
          <Stat label="Avg / day" value={String(summary.averagePerDay)} icon={<TrendingUp size={14} />} />
          <Stat label="Total" value={String(summary.total)} hint="all statuses" />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="card p-5">
          <h2 className="h3">Bookings over time</h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">
            Appointments by scheduled date
          </p>
          <div className="mt-4 h-64">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : series.length === 0 ? (
              <EmptyState title="No data yet" description="Bookings will chart here as they come in." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="booked" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f2fe0" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#4f2fe0" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-line)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fontSize: 11, fill: 'var(--color-ink-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--color-ink-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--color-line)',
                      boxShadow: 'var(--shadow-md)',
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="booked"
                    name="Booked"
                    stroke="#4f2fe0"
                    strokeWidth={2}
                    fill="url(#booked)"
                  />
                  <Area
                    type="monotone"
                    dataKey="cancelled"
                    name="Cancelled"
                    stroke="var(--color-danger)"
                    strokeWidth={1.5}
                    fill="transparent"
                    strokeDasharray="4 3"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="h3">Popular services</h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">Share of bookings</p>
          <div className="mt-4 h-64">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : summary.popularServices.length === 0 ? (
              <EmptyState title="Nothing booked yet" description="Service mix appears once bookings exist." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.popularServices}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {summary.popularServices.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLOURS[index % PIE_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--color-line)',
                      boxShadow: 'var(--shadow-md)',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {!loading ? (
            <ul className="mt-2 space-y-1.5">
              {summary.popularServices.map((service, index) => (
                <li key={service.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: PIE_COLOURS[index % PIE_COLOURS.length] }}
                  />
                  <span className="flex-1 truncate">{service.name}</span>
                  <span className="tabular font-semibold">{service.count}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="h3">Recent activity</h2>
          <Link href="/appointments" className="btn-ghost btn-sm">
            View all
          </Link>
        </div>

        {loading ? (
          <Skeleton className="h-64" />
        ) : recent.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No appointments yet"
              description="New bookings will appear here as soon as they come in."
            />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto scroll-slim">
              <table className="w-full">
                <thead className="bg-[var(--color-sunken)]">
                  <tr>
                    <th className="th">Reference</th>
                    <th className="th">Service</th>
                    <th className="th">Provider</th>
                    <th className="th">When</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((appointment) => (
                    <tr key={appointment.id} className="row">
                      <td className="td font-bold tabular">{appointment.code}</td>
                      <td className="td">{appointment.serviceName}</td>
                      <td className="td text-[var(--color-ink-muted)]">{appointment.providerName}</td>
                      <td className="td tabular whitespace-nowrap">
                        {new Date(appointment.startsAt).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                        })}{' '}
                        {formatTime(appointment.startsAt, appointment.timezone)}
                      </td>
                      <td className="td">
                        <StatusBadge status={appointment.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
