import Link from 'next/link';
import { api, formatMoney, type ServiceSummary } from '@/lib/api';
import { EmptyState, ErrorState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  let services: ServiceSummary[] = [];
  let error: string | null = null;

  try {
    services = await api<ServiceSummary[]>('/services');
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Could not load services.';
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-black tracking-tight">Book an appointment</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)] max-w-xl">
        Choose a service to see the next available times.
      </p>

      <div className="mt-8">
        {error ? (
          <ErrorState message={error} />
        ) : services.length === 0 ? (
          <EmptyState
            title="No services available"
            description="There are no bookable services at the moment. Please check back shortly."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <li key={service.id}>
                <Link
                  href={`/book/${service.slug}`}
                  className="card p-5 h-full flex flex-col hover:bg-[var(--color-surface-sunken)] transition-colors"
                >
                  <div
                    className="h-1 w-10 rounded-full mb-4"
                    style={{ background: service.color ?? 'var(--color-accent)' }}
                  />
                  <h2 className="font-bold text-lg leading-tight">{service.name}</h2>
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)] flex-1">
                    {service.description}
                  </p>
                  <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-line-soft)] pt-3">
                    <span className="text-sm font-semibold tabular-nums">
                      {service.durationMin} min
                    </span>
                    <span className="text-sm font-bold tabular-nums">
                      {formatMoney(service.priceMinor, service.currency)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-ink-subtle)]">
                    {service.locationType === 'ONLINE' ? 'Online' : 'In person'} ·{' '}
                    {service.providers.length} practitioner
                    {service.providers.length === 1 ? '' : 's'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
