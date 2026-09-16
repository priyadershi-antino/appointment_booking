'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, ExternalLink, MapPin, Stethoscope, Users } from 'lucide-react';
import { api, type ServiceSummary } from '@/lib/api';
import {
  currencyFormat,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '@/components/ui';

interface ProviderRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  bio: string | null;
  timezone: string;
  services: { id: string; name: string; slug: string }[];
}

/**
 * Catalog overview — services and who delivers them.
 *
 * Read-only for now. The booking rules shown here (duration, buffers, notice, horizon)
 * are exactly the inputs the slot engine uses, so this doubles as a way to see why a
 * given service offers the times it does.
 */
export default function ServicesPage() {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [serviceList, providerList] = await Promise.all([
        api<ServiceSummary[]>('/services'),
        api<ProviderRow[]>('/providers'),
      ]);
      setServices(serviceList);
      setProviders(providerList);
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load the catalog.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'error') {
    return (
      <>
        <PageHeader title="Services" />
        <ErrorState message={message} onRetry={() => void load()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Services"
        description="What can be booked, and the rules the slot engine applies to each."
      />

      {state === 'loading' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-52" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Stethoscope size={20} />}
            title="No services yet"
            description="Add a service and it becomes bookable straight away."
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <article key={service.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: service.color ?? 'var(--color-accent)' }}
                    />
                    <h2 className="h3 truncate">{service.name}</h2>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-[var(--color-ink-muted)]">
                    {service.description}
                  </p>
                </div>
                <Link
                  href={`/book/${service.slug}`}
                  target="_blank"
                  className="btn-ghost h-8 w-8 shrink-0 p-0"
                  aria-label={`Open the public booking page for ${service.name}`}
                >
                  <ExternalLink size={14} />
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-[var(--color-line)] pt-4 text-sm">
                <Detail icon={<Clock size={13} />} label="Duration">
                  {service.durationMin} min
                </Detail>
                <Detail label="Price">{currencyFormat(service.priceMinor, service.currency)}</Detail>
                <Detail icon={<MapPin size={13} />} label="Location">
                  {service.locationType === 'ONLINE'
                    ? 'Online'
                    : service.locationType === 'PHONE'
                      ? 'Phone'
                      : 'In person'}
                </Detail>
                <Detail icon={<Users size={13} />} label="Providers">
                  {service.providers.length}
                </Detail>
                <Detail label="Minimum notice">
                  {service.minNoticeMin >= 60
                    ? `${Math.round(service.minNoticeMin / 60)} h`
                    : `${service.minNoticeMin} min`}
                </Detail>
                <Detail label="Book up to">{service.maxAdvanceDays} days ahead</Detail>
              </div>

              {service.providers.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {service.providers.map((provider) => (
                    <span
                      key={provider.id}
                      className="rounded-full bg-[var(--color-sunken)] px-2.5 py-1 text-xs font-medium"
                    >
                      {provider.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {service.cancellationPolicy ? (
                <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-subtle)]">
                  {service.cancellationPolicy.description}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <section className="mt-8">
        <h2 className="h3 mb-3">Providers</h2>
        {state === 'loading' ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => (
              <article key={provider.id} className="card p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-sm font-bold text-[var(--color-accent)]">
                    {provider.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{provider.name}</p>
                    <p className="truncate text-xs text-[var(--color-ink-subtle)]">
                      {provider.title ?? provider.email}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                  <span className="font-semibold">Timezone</span> {provider.timezone}
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  <span className="font-semibold">Offers</span>{' '}
                  {provider.services.map((service) => service.name).join(', ') || 'nothing yet'}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-subtle)]">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 font-semibold tabular">{children}</p>
    </div>
  );
}
