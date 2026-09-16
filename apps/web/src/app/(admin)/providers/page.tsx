'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Pencil, Plus, Power, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import {
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  useToast,
} from '@/components/ui';
import { useSession } from '@/components/session';

interface AdminProvider {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  slug: string;
  title: string | null;
  bio: string | null;
  timezone: string;
  isActive: boolean;
  serviceIds: string[];
  appointmentCount: number;
  availabilityRuleCount: number;
}

interface Staff {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'PROVIDER';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface ServiceOption {
  id: string;
  name: string;
}

const COMMON_ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

/**
 * Staff onboarding.
 *
 * Creating a provider creates their sign-in account and their profile together — a
 * profile nobody can log into is a half-built state that is easy to produce and annoying
 * to diagnose. Admins are created here too, because self-registration deliberately
 * hard-codes CUSTOMER so no request payload can promote itself.
 */
export default function ProvidersPage() {
  const toast = useToast();
  const { user } = useSession();

  const [tab, setTab] = useState<'providers' | 'staff'>('providers');
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProvider | null>(null);
  const [confirmOff, setConfirmOff] = useState<AdminProvider | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  const [draft, setDraft] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    title: '',
    bio: '',
    timezone: 'Asia/Kolkata',
    serviceIds: [] as string[],
  });
  const [adminDraft, setAdminDraft] = useState({ name: '', email: '', password: '' });

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [providerList, serviceList] = await Promise.all([
        api<AdminProvider[]>('/admin/providers'),
        api<ServiceOption[]>('/admin/services'),
      ]);
      setProviders(providerList);
      setServices(serviceList);

      // Only an admin may list staff accounts; a provider viewing this page gets the
      // provider tab alone rather than a failed request.
      if (user?.role === 'ADMIN') {
        setStaff(await api<Staff[]>('/admin/staff').catch(() => []));
      }
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load providers.');
      setState('error');
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setDraft({
      name: '',
      email: '',
      password: '',
      phone: '',
      title: '',
      bio: '',
      timezone: 'Asia/Kolkata',
      serviceIds: [],
    });
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(provider: AdminProvider) {
    setDraft({
      name: provider.name,
      email: provider.email,
      password: '',
      phone: provider.phone ?? '',
      title: provider.title ?? '',
      bio: provider.bio ?? '',
      timezone: provider.timezone,
      serviceIds: provider.serviceIds,
    });
    setEditing(provider);
    setFormOpen(true);
  }

  async function saveProvider() {
    setBusy(true);
    try {
      if (editing) {
        await api(`/admin/providers/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: draft.name,
            phone: draft.phone || null,
            title: draft.title || null,
            bio: draft.bio || null,
            timezone: draft.timezone,
            serviceIds: draft.serviceIds,
          }),
        });
        toast('success', 'Provider updated.');
      } else {
        await api('/admin/providers', {
          method: 'POST',
          body: JSON.stringify({
            name: draft.name,
            email: draft.email,
            password: draft.password,
            phone: draft.phone || null,
            title: draft.title || null,
            bio: draft.bio || null,
            timezone: draft.timezone,
            serviceIds: draft.serviceIds,
          }),
        });
        toast('success', 'Provider onboarded. Set their working hours next.');
      }
      setFormOpen(false);
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

  async function createAdmin() {
    setBusy(true);
    try {
      await api('/admin/staff', {
        method: 'POST',
        body: JSON.stringify({ ...adminDraft, role: 'ADMIN', timezone: 'Asia/Kolkata' }),
      });
      toast('success', 'Admin account created.');
      setAdminOpen(false);
      setAdminDraft({ name: '', email: '', password: '' });
      await load();
    } catch (error) {
      toast(
        'error',
        error instanceof ApiRequestError
          ? (error.error.details?.[0]?.message ?? error.error.message)
          : 'Could not create the account.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!confirmOff) return;
    setBusy(true);
    try {
      await api(`/admin/providers/${confirmOff.id}`, { method: 'DELETE' });
      toast('success', 'Provider deactivated. Their history is preserved.');
      setConfirmOff(null);
      await load();
    } catch (error) {
      toast(
        'error',
        error instanceof ApiRequestError ? error.error.message : 'Could not deactivate.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleStaff(member: Staff) {
    try {
      await api(`/admin/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      toast('success', member.isActive ? 'Account deactivated.' : 'Account reactivated.');
      await load();
    } catch (error) {
      toast('error', error instanceof ApiRequestError ? error.error.message : 'Could not update.');
    }
  }

  const canCreate = editing
    ? draft.name.trim().length >= 2
    : draft.name.trim().length >= 2 && draft.email.includes('@') && draft.password.length >= 10;

  return (
    <>
      <PageHeader
        title="Team"
        description="Onboard providers and manage who can sign in."
        actions={
          <>
            {user?.role === 'ADMIN' ? (
              <button type="button" className="btn-secondary" onClick={() => setAdminOpen(true)}>
                <ShieldCheck size={15} />
                <span className="hidden sm:inline">New admin</span>
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={openCreate}>
              <UserPlus size={15} />
              New provider
            </button>
          </>
        }
      />

      {user?.role === 'ADMIN' ? (
        <div className="mb-4">
          <SegmentedControl<'providers' | 'staff'>
            ariaLabel="Team view"
            options={[
              { value: 'providers', label: 'Providers' },
              { value: 'staff', label: 'All accounts' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      ) : null}

      {state === 'error' ? (
        <ErrorState message={message} onRetry={() => void load()} />
      ) : state === 'loading' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-52" />
          ))}
        </div>
      ) : tab === 'providers' ? (
        providers.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Users size={20} />}
              title="No providers yet"
              description="Add your first provider. Nothing can be booked until at least one exists with working hours set."
              action={
                <button type="button" className="btn-primary" onClick={openCreate}>
                  <UserPlus size={15} />
                  New provider
                </button>
              }
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => (
              <article
                key={provider.id}
                className={`card p-5 ${provider.isActive ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-sm font-bold text-[var(--color-accent)]">
                    {provider.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{provider.name}</p>
                    <p className="truncate text-xs text-[var(--color-ink-subtle)]">
                      {provider.title ?? provider.email}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      className="btn-ghost h-8 w-8 p-0"
                      aria-label={`Edit ${provider.name}`}
                      onClick={() => openEdit(provider)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost h-8 w-8 p-0 text-[var(--color-danger)]"
                      aria-label={`Deactivate ${provider.name}`}
                      onClick={() => setConfirmOff(provider)}
                    >
                      <Power size={14} />
                    </button>
                  </div>
                </div>

                <dl className="mt-4 space-y-1.5 border-t border-[var(--color-line)] pt-3 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-ink-subtle)]">Timezone</dt>
                    <dd className="font-semibold">{provider.timezone}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-ink-subtle)]">Services</dt>
                    <dd className="font-semibold tabular">{provider.serviceIds.length}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-ink-subtle)]">Appointments</dt>
                    <dd className="font-semibold tabular">{provider.appointmentCount}</dd>
                  </div>
                </dl>

                {provider.availabilityRuleCount === 0 ? (
                  <Link
                    href="/availability"
                    className="mt-3 flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] p-2 text-xs font-semibold text-[var(--color-warn)]"
                  >
                    <Clock size={13} />
                    No working hours — set them to enable booking
                  </Link>
                ) : null}

                {!provider.isActive ? (
                  <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-subtle)]">
                    Inactive
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto scroll-slim">
            <table className="w-full">
              <thead className="bg-[var(--color-sunken)]">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Email</th>
                  <th className="th">Role</th>
                  <th className="th">Last sign-in</th>
                  <th className="th">Status</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.id} className="row">
                    <td className="td font-semibold">{member.name}</td>
                    <td className="td text-[var(--color-ink-muted)]">{member.email}</td>
                    <td className="td">
                      <span className="badge bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                        {member.role.toLowerCase()}
                      </span>
                    </td>
                    <td className="td tabular text-[var(--color-ink-muted)]">
                      {member.lastLoginAt
                        ? new Date(member.lastLoginAt).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                          })
                        : 'Never'}
                    </td>
                    <td className="td">
                      <span
                        className={`badge ${member.isActive ? 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]' : 'bg-[var(--color-neutral-soft)] text-[var(--color-neutral)]'}`}
                      >
                        {member.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="td text-right">
                      {member.id === user?.id ? (
                        <span className="text-xs text-[var(--color-ink-subtle)]">You</span>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => void toggleStaff(member)}
                        >
                          {member.isActive ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Provider create / edit */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Onboard a provider'}
        description={
          editing
            ? undefined
            : 'This creates their sign-in account and profile together. Set their working hours afterwards.'
        }
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !canCreate}
              onClick={() => void saveProvider()}
            >
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create provider'}
            </button>
          </>
        }
      >
        <div className="max-h-[60vh] space-y-3 overflow-y-auto scroll-slim pr-1">
          <div>
            <label className="label" htmlFor="p-name">
              Full name
            </label>
            <input
              id="p-name"
              className="field"
              data-autofocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="p-email">
                Email
              </label>
              <input
                id="p-email"
                type="email"
                className="field"
                disabled={Boolean(editing)}
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              />
              {editing ? <p className="hint">Sign-in email cannot be changed here.</p> : null}
            </div>
            <div>
              <label className="label" htmlFor="p-phone">
                Phone
              </label>
              <input
                id="p-phone"
                className="field"
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              />
            </div>
          </div>

          {!editing ? (
            <div>
              <label className="label" htmlFor="p-pass">
                Initial password
              </label>
              <input
                id="p-pass"
                type="text"
                className="field"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
              <p className="hint">
                At least 10 characters with upper and lower case and a number. Share it with them
                and ask them to change it after their first sign-in.
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="p-title">
                Title
              </label>
              <input
                id="p-title"
                className="field"
                placeholder="Consultant Physician"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="p-tz">
                Timezone
              </label>
              <select
                id="p-tz"
                className="field"
                value={draft.timezone}
                onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
              >
                {COMMON_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="hint">Their working hours are interpreted in this zone.</p>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="p-bio">
              Bio
            </label>
            <textarea
              id="p-bio"
              className="field h-20 resize-none py-2"
              value={draft.bio}
              onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
            />
          </div>

          <fieldset>
            <legend className="label">Services they offer</legend>
            {services.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-muted)]">
                No services yet — create one first.
              </p>
            ) : (
              <div className="space-y-1.5">
                {services.map((service) => (
                  <label
                    key={service.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2.5 text-sm hover:bg-[var(--color-sunken)]"
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)]"
                      checked={draft.serviceIds.includes(service.id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          serviceIds: event.target.checked
                            ? [...draft.serviceIds, service.id]
                            : draft.serviceIds.filter((id) => id !== service.id),
                        })
                      }
                    />
                    <span className="font-medium">{service.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>
      </Dialog>

      {/* Admin create */}
      <Dialog
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        title="Create an admin account"
        description="Admins can manage everything: services, providers, availability and all appointments."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAdminOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                busy ||
                adminDraft.name.trim().length < 2 ||
                !adminDraft.email.includes('@') ||
                adminDraft.password.length < 10
              }
              onClick={() => void createAdmin()}
            >
              {busy ? 'Creating…' : 'Create admin'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="a-name">
              Full name
            </label>
            <input
              id="a-name"
              className="field"
              data-autofocus
              value={adminDraft.name}
              onChange={(event) => setAdminDraft({ ...adminDraft, name: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="a-email">
              Email
            </label>
            <input
              id="a-email"
              type="email"
              className="field"
              value={adminDraft.email}
              onChange={(event) => setAdminDraft({ ...adminDraft, email: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="a-pass">
              Initial password
            </label>
            <input
              id="a-pass"
              type="text"
              className="field"
              value={adminDraft.password}
              onChange={(event) => setAdminDraft({ ...adminDraft, password: event.target.value })}
            />
            <p className="hint">At least 10 characters, mixed case, with a number.</p>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmOff !== null}
        onClose={() => setConfirmOff(null)}
        title={`Deactivate ${confirmOff?.name}?`}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmOff(null)}>
              Keep active
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
          They stop appearing as bookable and can no longer sign in. Their past appointments are
          kept intact. If they still have upcoming bookings, those must be cancelled or reassigned
          first — the request will be refused rather than stranding those customers.
        </p>
      </Dialog>
    </>
  );
}
