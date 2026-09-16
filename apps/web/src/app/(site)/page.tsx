import Link from 'next/link';
import { ArrowRight, CalendarCheck, Clock, MapPin, ShieldCheck, Video } from 'lucide-react';
import { api, formatMoney, type ServiceSummary } from '@/lib/api';
import { EmptyState, ErrorState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let services: ServiceSummary[] = [];
  let error: string | null = null;

  try {
    services = await api<ServiceSummary[]>('/services');
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Could not load services.';
  }

  const categories = [...new Set(services.map((service) => service.category).filter(Boolean))];

  return (
    <>
      {/* Hero */}
      <section className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-xs font-bold text-[var(--color-accent)]">
              <CalendarCheck size={13} />
              Real-time availability
            </span>
            <h1 className="mt-5 text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[52px]">
              Book with Meridian
              <br />
              <span className="text-[var(--color-ink-muted)]">in under a minute.</span>
            </h1>
            <p className="lede mt-5 max-w-xl text-base">
              Pick a service, choose a time that actually works, and get an instant confirmation.
              No accounts, no phone queues, no waiting to hear back.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[var(--color-ink-muted)]">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={15} className="text-[var(--color-ok)]" />
                Instant confirmation
              </span>
              <span className="inline-flex items-center gap-2">
                <Clock size={15} className="text-[var(--color-ok)]" />
                Free rescheduling
              </span>
              <span className="inline-flex items-center gap-2">
                <Video size={15} className="text-[var(--color-ok)]" />
                In person or online
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="h2">Choose a service</h2>
            <p className="lede mt-1.5 text-sm">
              {services.length} available
              {categories.length > 0 ? ` across ${categories.join(', ').toLowerCase()}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-6">
          {error ? (
            <ErrorState message={error} />
          ) : services.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<CalendarCheck size={20} />}
                title="No services available"
                description="There is nothing bookable at the moment. Please check back shortly."
              />
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((service) => (
                <li key={service.id}>
                  <Link
                    href={`/book/${service.slug}`}
                    className="card-interactive group flex h-full flex-col p-5"
                  >
                    <div
                      className="mb-4 h-1 w-9 rounded-full"
                      style={{ background: service.color ?? 'var(--color-accent)' }}
                    />

                    {service.category ? (
                      <p className="eyebrow mb-1.5">{service.category}</p>
                    ) : null}
                    <h3 className="text-lg font-bold leading-tight">{service.name}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-ink-muted)]">
                      {service.description}
                    </p>

                    <div className="mt-5 flex items-center gap-4 text-xs text-[var(--color-ink-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock size={13} />
                        {service.durationMin} min
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        {service.locationType === 'ONLINE' ? (
                          <>
                            <Video size={13} /> Online
                          </>
                        ) : (
                          <>
                            <MapPin size={13} /> In person
                          </>
                        )}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[var(--color-line)] pt-4">
                      <span className="text-lg font-extrabold tabular">
                        {formatMoney(service.priceMinor, service.currency)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-accent)]">
                        Book
                        <ArrowRight
                          size={15}
                          className="transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
