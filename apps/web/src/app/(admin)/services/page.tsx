'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Pencil, Plus, Power, Stethoscope } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import {
  currencyFormat,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  useToast,
} from '@/components/ui';

interface AdminService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  slotIntervalMin: number;
  priceMinor: number;
  currency: string;
  locationType: 'IN_PERSON' | 'ONLINE' | 'PHONE';
  locationDetail: string | null;
  minNoticeMin: number;
  maxAdvanceDays: number;
  maxPerDay: number | null;
  maxPerCustomerPerDay: number;
  color: string | null;
  isActive: boolean;
  providerIds: string[];
  appointmentCount: number;
}

interface ProviderOption {
  id: string;
  name: string;
  title: string | null;
}

type Draft = {
  name: string;
  description: string;
  category: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  slotIntervalMin: number;
  price: number;
  locationType: 'IN_PERSON' | 'ONLINE' | 'PHONE';
  locationDetail: string;
  minNoticeMin: number;
  maxAdvanceDays: number;
  maxPerDay: string;
  maxPerCustomerPerDay: number;
  color: string;
  isActive: boolean;
  providerIds: string[];
};

const blank = (): Draft => ({
  name: '',
  description: '',
  category: '',
  durationMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  slotIntervalMin: 15,
  price: 0,
  locationType: 'IN_PERSON',
  locationDetail: '',
  minNoticeMin: 120,
  maxAdvanceDays: 30,
  maxPerDay: '',
  maxPerCustomerPerDay: 1,
  color: '#4f2fe0',
  isActive: true,
  providerIds: [],
});

/**
 * Service catalog management.
 *
 * Everything the slot engine reads about a service is editable here — duration, buffers,
 * slot interval, notice, horizon and caps — because leaving those to the seed script
 * meant the catalog could only ever be changed by a developer with database access.
 */
export default function ServicesPage() {
  const toast = useToast();
  const [services, setServices] = useState<AdminService[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const [editing, setEditing] = useState<AdminService | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState<AdminService | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [serviceList, providerList] = await Promise.all([
        api<AdminService[]>('/admin/services'),
        api<ProviderOption[]>('/admin/providers'),
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

  function openCreate() {
    setDraft(blank());
    setEditing(null);
    setCreating(true);
  }

  function openEdit(service: AdminService) {
    setDraft({
      name: service.name,
      description: service.description ?? '',
      category: service.category ?? '',
      durationMin: service.durationMin,
      bufferBeforeMin: service.bufferBeforeMin,
      bufferAfterMin: service.bufferAfterMin,
      slotIntervalMin: service.slotIntervalMin,
      price: service.priceMinor / 100,
      locationType: service.locationType,
      locationDetail: service.locationDetail ?? '',
      minNoticeMin: service.minNoticeMin,
      maxAdvanceDays: service.maxAdvanceDays,
      maxPerDay: service.maxPerDay === null ? '' : String(service.maxPerDay),
      maxPerCustomerPerDay: service.maxPerCustomerPerDay,
      color: service.color ?? '#4f2fe0',
      isActive: service.isActive,
      providerIds: service.providerIds,
    });
    setEditing(service);
    setCreating(true);
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name: draft.name,
        description: draft.description || null,
        category: draft.category || null,
        durationMin: Number(draft.durationMin),
        bufferBeforeMin: Number(draft.bufferBeforeMin),
        bufferAfterMin: Number(draft.bufferAfterMin),
        slotIntervalMin: Number(draft.slotIntervalMin),
        // The API works in minor units throughout, so money never rides on a float.
        priceMinor: Math.round(Number(draft.price) * 100),
        currency: 'INR',
        locationType: draft.locationType,
        locationDetail: draft.locationDetail || null,
        minNoticeMin: Number(draft.minNoticeMin),
        maxAdvanceDays: Number(draft.maxAdvanceDays),
        maxPerDay: draft.maxPerDay === '' ? null : Number(draft.maxPerDay),
        maxPerCustomerPerDay: Number(draft.maxPerCustomerPerDay),
        color: draft.color,
        isActive: draft.isActive,
        providerIds: draft.providerIds,
      };

      if (editing) {
        await api(`/admin/services/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast('success', 'Service updated. New bookings use these rules immediately.');
      } else {
        await api('/admin/services', { method: 'POST', body: JSON.stringify(payload) });
        toast('success', 'Service created and live on the booking page.');
      }

      setCreating(false);
      setEditing(null);
      await load();
    } catch (error) {
      toast(
        'error',
        error instanceof ApiRequestError
          ? (error.error.details?.[0]?.message ?? error.error.message)
          : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!confirmOff) return;
    setBusy(true);
    try {
      const result = await api<{ retained: boolean }>(`/admin/services/${confirmOff.id}`, {
        method: 'DELETE',
      });
      toast(
        'success',
        result.retained
          ? 'Service deactivated. Existing appointments are untouched.'
          : 'Service removed.',
      );
      setConfirmOff(null);
      await load();
    } catch (error) {
      toast('error', error instanceof ApiRequestError ? error.error.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader
        title="Services"
        description="What can be booked, and the rules the slot engine applies to each."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={15} />
            New service
          </button>
        }
      />

      {state === 'error' ? (
        <ErrorState message={message} onRetry={() => void load()} />
      ) : state === 'loading' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-60" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Stethoscope size={20} />}
            title="No services yet"
            description="Add your first service and it becomes bookable straight away."
            action={
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus size={15} />
                New service
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <article
              key={service.id}
              className={`card p-5 ${service.isActive ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: service.color ?? 'var(--color-accent)' }}
                    />
                    <h2 className="h3 truncate">{service.name}</h2>
                    {!service.isActive ? (
                      <span className="badge bg-[var(--color-neutral-soft)] text-[var(--color-neutral)]">
                        Inactive
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-[var(--color-ink-muted)]">
                    {service.description || 'No description'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Link
                    href={`/book/${service.slug}`}
                    target="_blank"
                    className="btn-ghost h-8 w-8 p-0"
                    aria-label={`Preview ${service.name}`}
                  >
                    <ExternalLink size={14} />
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost h-8 w-8 p-0"
                    aria-label={`Edit ${service.name}`}
                    onClick={() => openEdit(service)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost h-8 w-8 p-0 text-[var(--color-danger)]"
                    aria-label={`Deactivate ${service.name}`}
                    onClick={() => setConfirmOff(service)}
                  >
                    <Power size={14} />
                  </button>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-[var(--color-line)] pt-4 text-sm sm:grid-cols-3">
                <Detail label="Duration">{service.durationMin} min</Detail>
                <Detail label="Price">{currencyFormat(service.priceMinor, service.currency)}</Detail>
                <Detail label="Slot every">{service.slotIntervalMin} min</Detail>
                <Detail label="Buffers">
                  {service.bufferBeforeMin}/{service.bufferAfterMin}
                </Detail>
                <Detail label="Notice">
                  {service.minNoticeMin >= 60
                    ? `${Math.round(service.minNoticeMin / 60)} h`
                    : `${service.minNoticeMin} m`}
                </Detail>
                <Detail label="Horizon">{service.maxAdvanceDays} d</Detail>
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {service.providerIds.length === 0 ? (
                  <span className="text-xs font-semibold text-[var(--color-danger)]">
                    No providers assigned — this cannot be booked
                  </span>
                ) : (
                  service.providerIds.map((id) => (
                    <span
                      key={id}
                      className="rounded-full bg-[var(--color-sunken)] px-2.5 py-1 text-xs font-medium"
                    >
                      {providers.find((p) => p.id === id)?.name ?? 'Unknown'}
                    </span>
                  ))
                )}
              </div>

              {service.appointmentCount > 0 ? (
                <p className="mt-3 text-xs text-[var(--color-ink-subtle)]">
                  {service.appointmentCount} appointment
                  {service.appointmentCount === 1 ? '' : 's'} booked
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {/* Create / edit */}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={editing ? `Edit ${editing.name}` : 'New service'}
        description={
          editing
            ? 'Existing appointments keep the rules they were booked under — they are snapshotted.'
            : 'These rules are exactly what the slot engine uses to decide what is bookable.'
        }
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || draft.name.trim().length < 2}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create service'}
            </button>
          </>
        }
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto scroll-slim pr-1">
          <div>
            <label className="label" htmlFor="s-name">
              Name
            </label>
            <input
              id="s-name"
              className="field"
              data-autofocus
              value={draft.name}
              onChange={(event) => set('name', event.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="s-desc">
              Description
            </label>
            <textarea
              id="s-desc"
              className="field h-20 resize-none py-2"
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" id="s-cat">
              <input
                id="s-cat"
                className="field"
                value={draft.category}
                onChange={(event) => set('category', event.target.value)}
              />
            </Field>
            <Field label="Price (₹)" id="s-price">
              <input
                id="s-price"
                type="number"
                min={0}
                className="field"
                value={draft.price}
                onChange={(event) => set('price', Number(event.target.value))}
              />
            </Field>
          </div>

          <fieldset className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Timing
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration (min)" id="s-dur">
                <input
                  id="s-dur"
                  type="number"
                  min={5}
                  className="field"
                  value={draft.durationMin}
                  onChange={(event) => set('durationMin', Number(event.target.value))}
                />
              </Field>
              <Field label="Slot every (min)" id="s-int">
                <select
                  id="s-int"
                  className="field"
                  value={draft.slotIntervalMin}
                  onChange={(event) => set('slotIntervalMin', Number(event.target.value))}
                >
                  {[5, 10, 15, 20, 30, 60].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Buffer before (min)" id="s-bb">
                <input
                  id="s-bb"
                  type="number"
                  min={0}
                  className="field"
                  value={draft.bufferBeforeMin}
                  onChange={(event) => set('bufferBeforeMin', Number(event.target.value))}
                />
              </Field>
              <Field label="Buffer after (min)" id="s-ba">
                <input
                  id="s-ba"
                  type="number"
                  min={0}
                  className="field"
                  value={draft.bufferAfterMin}
                  onChange={(event) => set('bufferAfterMin', Number(event.target.value))}
                />
              </Field>
            </div>
            <p className="hint">
              Buffers reserve time either side and stack between neighbours, so the gap between
              two appointments is this service&apos;s after-buffer plus the next one&apos;s
              before-buffer.
            </p>
          </fieldset>

          <fieldset className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Booking window
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min notice (min)" id="s-notice">
                <input
                  id="s-notice"
                  type="number"
                  min={0}
                  className="field"
                  value={draft.minNoticeMin}
                  onChange={(event) => set('minNoticeMin', Number(event.target.value))}
                />
              </Field>
              <Field label="Book up to (days)" id="s-adv">
                <input
                  id="s-adv"
                  type="number"
                  min={1}
                  className="field"
                  value={draft.maxAdvanceDays}
                  onChange={(event) => set('maxAdvanceDays', Number(event.target.value))}
                />
              </Field>
              <Field label="Max per day" id="s-cap">
                <input
                  id="s-cap"
                  type="number"
                  min={1}
                  placeholder="No limit"
                  className="field"
                  value={draft.maxPerDay}
                  onChange={(event) => set('maxPerDay', event.target.value)}
                />
              </Field>
              <Field label="Max per customer/day" id="s-ccap">
                <input
                  id="s-ccap"
                  type="number"
                  min={1}
                  className="field"
                  value={draft.maxPerCustomerPerDay}
                  onChange={(event) => set('maxPerCustomerPerDay', Number(event.target.value))}
                />
              </Field>
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Location" id="s-loc">
              <select
                id="s-loc"
                className="field"
                value={draft.locationType}
                onChange={(event) =>
                  set('locationType', event.target.value as Draft['locationType'])
                }
              >
                <option value="IN_PERSON">In person</option>
                <option value="ONLINE">Online</option>
                <option value="PHONE">Phone</option>
              </select>
            </Field>
            <Field label="Colour" id="s-color">
              <input
                id="s-color"
                type="color"
                className="field p-1"
                value={draft.color}
                onChange={(event) => set('color', event.target.value)}
              />
            </Field>
          </div>

          <Field label="Location detail" id="s-locd">
            <input
              id="s-locd"
              className="field"
              placeholder="Clinic address, or how the video link is sent"
              value={draft.locationDetail}
              onChange={(event) => set('locationDetail', event.target.value)}
            />
          </Field>

          <fieldset>
            <legend className="label">Providers who offer this</legend>
            {providers.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                No providers yet — add one first, or this service cannot be booked.
              </p>
            ) : (
              <div className="space-y-1.5">
                {providers.map((provider) => (
                  <label
                    key={provider.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2.5 text-sm hover:bg-[var(--color-sunken)]"
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)]"
                      checked={draft.providerIds.includes(provider.id)}
                      onChange={(event) =>
                        set(
                          'providerIds',
                          event.target.checked
                            ? [...draft.providerIds, provider.id]
                            : draft.providerIds.filter((id) => id !== provider.id),
                        )
                      }
                    />
                    <span className="font-medium">{provider.name}</span>
                    {provider.title ? (
                      <span className="text-xs text-[var(--color-ink-subtle)]">
                        {provider.title}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="accent-[var(--color-accent)]"
              checked={draft.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
            />
            <span className="font-medium">Bookable — show on the public booking page</span>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={confirmOff !== null}
        onClose={() => setConfirmOff(null)}
        title={`Deactivate ${confirmOff?.name}?`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmOff(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => void deactivate()}
            >
              {busy ? 'Working…' : 'Deactivate'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-ink-muted)]">
          It disappears from the booking page immediately.
          {confirmOff && confirmOff.appointmentCount > 0
            ? ` Its ${confirmOff.appointmentCount} existing appointment(s) are kept intact, along with the prices and durations they were booked at.`
            : ' Nothing has been booked against it, so it will be removed entirely.'}
        </p>
      </Dialog>
    </>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-subtle)]">
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold tabular">{children}</dd>
    </div>
  );
}
