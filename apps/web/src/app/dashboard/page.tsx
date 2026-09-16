import { api, formatMoney, formatTime, type Appointment } from '@/lib/api';
import { EmptyState, ErrorState, Stat, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

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
 * Reads through the same authenticated API as everything else — the dashboard has no
 * privileged back channel, so what it can show is exactly what the signed-in user is
 * permitted to read.
 */
export default async function DashboardPage() {
  let summary: Summary | null = null;
  let appointments: Appointment[] = [];
  let error: string | null = null;

  try {
    [summary, appointments] = await Promise.all([
      api<Summary>('/analytics/summary?days=30'),
      api<Appointment[]>('/appointments?pageSize=10'),
    ]);
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : 'Could not load the dashboard.';
  }

  if (error || !summary) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-black tracking-tight mb-6">Dashboard</h1>
        <ErrorState
          message={`${error ?? 'Unavailable.'} Sign in as admin@example.com to view this page.`}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-black tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Last 30 days</p>

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
        <Stat label="Revenue" value={formatMoney(summary.revenueMinor, 'INR')} hint="completed only" />
        <Stat label="Avg / day" value={String(summary.averagePerDay)} />
        <Stat label="Total" value={String(summary.total)} hint="all statuses" />
      </div>

      <section className="mt-10">
        <h2 className="font-bold mb-3">Recent appointments</h2>
        {appointments.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No appointments found"
              description="Nothing has been booked yet. New bookings will appear here."
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
                      className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]"
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
                    <td className="px-4 py-3 font-bold tabular-nums">{appointment.code}</td>
                    <td className="px-4 py-3">{appointment.serviceName}</td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
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
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {formatMoney(appointment.priceMinor, appointment.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-bold mb-3">Popular services</h2>
        <div className="card p-5 space-y-3">
          {summary.popularServices.map((service) => {
            const max = summary.popularServices[0]?.count || 1;
            return (
              <div key={service.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold">{service.name}</span>
                  <span className="tabular-nums text-[var(--color-ink-muted)]">{service.count}</span>
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
    </div>
  );
}
