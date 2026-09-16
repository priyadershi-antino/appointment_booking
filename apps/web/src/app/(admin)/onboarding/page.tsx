'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Copy,
  ShieldCheck,
  Stethoscope,
  UserPlus,
} from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { ErrorState, PageHeader, useToast } from '@/components/ui';
import { useSession } from '@/components/session';

type Role = 'PROVIDER' | 'ADMIN';
type Step = 0 | 1 | 2 | 3;

interface ServiceOption {
  id: string;
  name: string;
  durationMin: number;
}

interface Window {
  startMinute: number;
  endMinute: number;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

const toHHMM = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (value: string): number => {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Mon–Fri 09:00–17:00. A sensible default beats an empty week nobody fills in. */
const defaultWeek = (): Window[][] =>
  Array.from({ length: 7 }, (_, day) =>
    day >= 1 && day <= 5 ? [{ startMinute: 540, endMinute: 1020 }] : [],
  );

const randomPassword = (): string => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  // Guarantee one of each class so it satisfies the policy rather than failing validation
  // on the last step after everything else has been filled in.
  const core = [pick(upper), pick(lower), pick(digits), '@'];
  while (core.length < 14) core.push(pick(all));
  return core.sort(() => Math.random() - 0.5).join('');
};

/**
 * Guided staff onboarding.
 *
 * A doctor is not one record — they need a sign-in account, a profile, the services they
 * deliver and working hours, and they are not bookable until all four exist. Doing it as
 * a wizard makes that dependency visible rather than leaving someone to discover, days
 * later, that a provider they created never appeared on the booking page because nobody
 * set their hours.
 */
export default function OnboardingPage() {
  const toast = useToast();
  const router = useRouter();
  const { user } = useSession();

  const [step, setStep] = useState<Step>(0);
  const [role, setRole] = useState<Role>('PROVIDER');
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; email: string; password: string } | null>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: randomPassword(),
    phone: '',
    title: '',
    bio: '',
    timezone: 'Asia/Kolkata',
  });
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [week, setWeek] = useState<Window[][]>(defaultWeek);

  const load = useCallback(async () => {
    try {
      setServices(await api<ServiceOption[]>('/admin/services'));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load services.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const steps =
    role === 'ADMIN'
      ? ['Role', 'Account', 'Review']
      : ['Role', 'Account', 'Services & hours', 'Review'];
  const lastStep = (steps.length - 1) as Step;

  const accountValid =
    form.name.trim().length >= 2 && form.email.includes('@') && form.password.length >= 10;

  async function submit() {
    setBusy(true);
    try {
      if (role === 'ADMIN') {
        await api('/admin/staff', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            password: form.password,
            phone: form.phone || null,
            timezone: form.timezone,
            role: 'ADMIN',
          }),
        });
      } else {
        const provider = await api<{ id: string }>('/admin/providers', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            password: form.password,
            phone: form.phone || null,
            title: form.title || null,
            bio: form.bio || null,
            timezone: form.timezone,
            serviceIds,
          }),
        });

        // Hours are a second call because they belong to the provider, which cannot be
        // referenced until it exists. A failure here leaves a usable provider with no
        // hours rather than no provider at all, so it warns instead of failing the flow.
        const rules = week.flatMap((windows, weekday) =>
          windows.map((window) => ({ weekday, ...window })),
        );
        if (rules.length > 0) {
          await api(`/providers/${provider.id}/availability`, {
            method: 'PUT',
            body: JSON.stringify({ rules }),
          }).catch(() =>
            toast('error', 'Account created, but working hours did not save. Set them manually.'),
          );
        }
      }

      setDone({ name: form.name, email: form.email, password: form.password });
    } catch (error) {
      toast(
        'error',
        error instanceof ApiRequestError
          ? (error.error.details?.[0]?.message ?? error.error.message)
          : 'Could not complete onboarding.',
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null);
    setStep(0);
    setRole('PROVIDER');
    setForm({
      name: '',
      email: '',
      password: randomPassword(),
      phone: '',
      title: '',
      bio: '',
      timezone: 'Asia/Kolkata',
    });
    setServiceIds([]);
    setWeek(defaultWeek());
    void load();
  }

  if (user?.role !== 'ADMIN') {
    return (
      <>
        <PageHeader title="Onboard a team member" />
        <ErrorState message="Only administrators can onboard new team members." />
      </>
    );
  }

  /* ── Success ─────────────────────────────────────────────────────────── */
  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-ok-soft)] text-[var(--color-ok)]">
            <Check size={24} />
          </div>
          <h1 className="h1 mt-5">{done.name} is set up</h1>
          <p className="lede mt-2">
            Share these credentials. Ask them to change the password after signing in.
          </p>

          <div className="mt-6 space-y-2 rounded-[var(--radius-md)] bg-[var(--color-sunken)] p-4 text-left">
            <Credential label="Email" value={done.email} />
            <Credential label="Password" value={done.password} />
          </div>

          <button
            type="button"
            className="btn-secondary mt-4 w-full"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(`Email: ${done.email}\nPassword: ${done.password}`)
                .then(() => toast('success', 'Credentials copied.'))
                .catch(() => toast('error', 'Copy failed — select the text instead.'));
            }}
          >
            <Copy size={15} />
            Copy credentials
          </button>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn-secondary flex-1" onClick={reset}>
              Onboard another
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => router.push('/providers')}
            >
              View the team
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Wizard ──────────────────────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Onboard a team member"
        description="Create a sign-in account and everything they need to start working."
      />

      {loadError ? (
        <div className="mb-4">
          <ErrorState message={loadError} onRetry={() => void load()} />
        </div>
      ) : null}

      {/* Progress */}
      <ol className="mb-6 flex items-center gap-2">
        {steps.map((label, index) => {
          const state = index < step ? 'done' : index === step ? 'current' : 'todo';
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  state === 'done'
                    ? 'bg-[var(--color-ok)] text-white'
                    : state === 'current'
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-sunken)] text-[var(--color-ink-subtle)]',
                ].join(' ')}
              >
                {state === 'done' ? <Check size={14} /> : index + 1}
              </span>
              <span
                className={`hidden text-xs font-semibold sm:block ${state === 'todo' ? 'text-[var(--color-ink-subtle)]' : ''}`}
              >
                {label}
              </span>
              {index < steps.length - 1 ? (
                <span className="h-px flex-1 bg-[var(--color-line)]" />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="card p-5 sm:p-6">
        {/* Step 0 — role */}
        {step === 0 ? (
          <fieldset>
            <legend className="h2 mb-1">What kind of account?</legend>
            <p className="lede mb-5 text-sm">This decides what they can see and do.</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <RoleCard
                selected={role === 'PROVIDER'}
                onSelect={() => setRole('PROVIDER')}
                icon={<Stethoscope size={18} />}
                title="Provider"
                blurb="A doctor or practitioner who takes appointments. Gets a calendar, their own availability, and the appointments assigned to them."
              />
              <RoleCard
                selected={role === 'ADMIN'}
                onSelect={() => setRole('ADMIN')}
                icon={<ShieldCheck size={18} />}
                title="Administrator"
                blurb="Full access: services, providers, every appointment, availability and analytics. Can onboard other people."
              />
            </div>
          </fieldset>
        ) : null}

        {/* Step 1 — account */}
        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <h2 className="h2">Their details</h2>
              <p className="lede text-sm">This creates their sign-in account.</p>
            </div>

            <Labelled label="Full name" id="o-name">
              <input
                id="o-name"
                className="field"
                autoFocus
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Labelled>

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Email" id="o-email">
                <input
                  id="o-email"
                  type="email"
                  className="field"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </Labelled>
              <Labelled label="Phone" id="o-phone" optional>
                <input
                  id="o-phone"
                  className="field"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
              </Labelled>
            </div>

            <Labelled label="Initial password" id="o-pass">
              <div className="flex gap-2">
                <input
                  id="o-pass"
                  className="field font-mono"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  onClick={() => setForm({ ...form, password: randomPassword() })}
                >
                  Regenerate
                </button>
              </div>
              <p className="hint">
                Generated for you. You will see it once more at the end — share it with them
                directly and ask them to change it.
              </p>
            </Labelled>

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Timezone" id="o-tz">
                <select
                  id="o-tz"
                  className="field"
                  value={form.timezone}
                  onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                >
                  {ZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
                {role === 'PROVIDER' ? (
                  <p className="hint">Their working hours are read in this zone.</p>
                ) : null}
              </Labelled>
              {role === 'PROVIDER' ? (
                <Labelled label="Title" id="o-title" optional>
                  <input
                    id="o-title"
                    className="field"
                    placeholder="Consultant Physician"
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                  />
                </Labelled>
              ) : null}
            </div>

            {role === 'PROVIDER' ? (
              <Labelled label="Bio" id="o-bio" optional>
                <textarea
                  id="o-bio"
                  className="field h-20 resize-none py-2"
                  placeholder="Shown to customers on the booking page."
                  value={form.bio}
                  onChange={(event) => setForm({ ...form, bio: event.target.value })}
                />
              </Labelled>
            ) : null}
          </div>
        ) : null}

        {/* Step 2 — services and hours (providers only) */}
        {step === 2 && role === 'PROVIDER' ? (
          <div className="space-y-6">
            <div>
              <h2 className="h2">What they do, and when</h2>
              <p className="lede text-sm">
                Both are needed before anything can be booked with them.
              </p>
            </div>

            <fieldset>
              <legend className="label">Services they offer</legend>
              {services.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] p-3 text-sm text-[var(--color-warn)]">
                  There are no services yet. You can finish here and assign them later, but nothing
                  will be bookable until a service exists.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {services.map((service) => (
                    <label
                      key={service.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3 text-sm hover:bg-[var(--color-sunken)]"
                    >
                      <input
                        type="checkbox"
                        className="accent-[var(--color-accent)]"
                        checked={serviceIds.includes(service.id)}
                        onChange={(event) =>
                          setServiceIds(
                            event.target.checked
                              ? [...serviceIds, service.id]
                              : serviceIds.filter((id) => id !== service.id),
                          )
                        }
                      />
                      <span className="flex-1 font-medium">{service.name}</span>
                      <span className="text-xs tabular text-[var(--color-ink-subtle)]">
                        {service.durationMin} min
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend className="label">Working hours</legend>
              <p className="hint mb-2 mt-0">
                Pre-filled with Monday to Friday, 09:00–17:00. Adjust or clear any day.
              </p>
              <div className="divide-y divide-[var(--color-line)] rounded-[var(--radius-sm)] border border-[var(--color-line)]">
                {DAYS.map((label, day) => {
                  const windows = week[day]!;
                  return (
                    <div key={label} className="flex flex-wrap items-center gap-2 p-2.5">
                      <span className="w-24 shrink-0 text-sm font-semibold">{label}</span>
                      {windows.length === 0 ? (
                        <>
                          <span className="flex-1 text-xs text-[var(--color-ink-subtle)]">
                            Not working
                          </span>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => {
                              const next = week.map((w) => [...w]);
                              next[day]!.push({ startMinute: 540, endMinute: 1020 });
                              setWeek(next);
                            }}
                          >
                            Add
                          </button>
                        </>
                      ) : (
                        windows.map((window, index) => (
                          <div key={index} className="flex flex-1 items-center gap-2">
                            <input
                              type="time"
                              className="field w-28"
                              step={900}
                              aria-label={`${label} start`}
                              value={toHHMM(window.startMinute)}
                              onChange={(event) => {
                                const next = week.map((w) => w.map((x) => ({ ...x })));
                                next[day]![index]!.startMinute = toMinutes(event.target.value);
                                setWeek(next);
                              }}
                            />
                            <span className="text-xs text-[var(--color-ink-subtle)]">to</span>
                            <input
                              type="time"
                              className="field w-28"
                              step={900}
                              aria-label={`${label} end`}
                              value={toHHMM(window.endMinute)}
                              onChange={(event) => {
                                const next = week.map((w) => w.map((x) => ({ ...x })));
                                next[day]![index]!.endMinute = toMinutes(event.target.value);
                                setWeek(next);
                              }}
                            />
                            <button
                              type="button"
                              className="btn-ghost h-8 w-8 p-0 text-[var(--color-danger)]"
                              aria-label={`Clear ${label}`}
                              onClick={() => {
                                const next = week.map((w) => [...w]);
                                next[day]!.splice(index, 1);
                                setWeek(next);
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </div>
        ) : null}

        {/* Final — review */}
        {step === lastStep ? (
          <div className="space-y-4">
            <div>
              <h2 className="h2">Ready to create</h2>
              <p className="lede text-sm">Check this over, then confirm.</p>
            </div>

            <dl className="divide-y divide-[var(--color-line)] rounded-[var(--radius-sm)] border border-[var(--color-line)]">
              <Review label="Role" value={role === 'ADMIN' ? 'Administrator' : 'Provider'} />
              <Review label="Name" value={form.name} />
              <Review label="Email" value={form.email} />
              {form.phone ? <Review label="Phone" value={form.phone} /> : null}
              <Review label="Timezone" value={form.timezone} />
              {role === 'PROVIDER' ? (
                <>
                  {form.title ? <Review label="Title" value={form.title} /> : null}
                  <Review
                    label="Services"
                    value={
                      serviceIds.length === 0
                        ? 'None yet'
                        : services
                            .filter((service) => serviceIds.includes(service.id))
                            .map((service) => service.name)
                            .join(', ')
                    }
                  />
                  <Review
                    label="Working days"
                    value={
                      week.filter((windows) => windows.length > 0).length === 0
                        ? 'None set'
                        : week
                            .map((windows, day) => (windows.length > 0 ? DAYS[day]!.slice(0, 3) : null))
                            .filter(Boolean)
                            .join(', ')
                    }
                  />
                </>
              ) : null}
            </dl>

            {role === 'PROVIDER' && (serviceIds.length === 0 || week.every((w) => w.length === 0)) ? (
              <p className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] p-3 text-sm text-[var(--color-warn)]">
                <Clock size={15} className="mt-0.5 shrink-0" />
                They will not be bookable until they have both at least one service and some
                working hours. You can add the missing part afterwards.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5">
          <button
            type="button"
            className="btn-ghost"
            disabled={step === 0 || busy}
            onClick={() => setStep((current) => Math.max(0, current - 1) as Step)}
          >
            <ArrowLeft size={15} />
            Back
          </button>

          {step === lastStep ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !accountValid}
              onClick={() => void submit()}
            >
              {busy ? 'Creating…' : (
                <>
                  <UserPlus size={15} />
                  Create account
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={step === 1 && !accountValid}
              onClick={() => setStep((current) => (current + 1) as Step)}
            >
              Continue
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  selected,
  onSelect,
  icon,
  title,
  blurb,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={[
        'rounded-[var(--radius-md)] border p-4 text-left transition-all',
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] ring-2 ring-[var(--color-accent-ring)]/40'
          : 'border-[var(--color-line)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-sunken)]',
      ].join(' ')}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] ${selected ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-sunken)] text-[var(--color-ink-muted)]'}`}
      >
        {icon}
      </span>
      <p className="mt-3 font-bold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">{blurb}</p>
    </button>
  );
}

function Labelled({
  label,
  id,
  optional,
  children,
}: {
  label: string;
  id: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {optional ? <span className="font-normal normal-case"> (optional)</span> : null}
      </label>
      {children}
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 text-sm">
      <dt className="text-[var(--color-ink-subtle)]">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

function Credential({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink-subtle)]">
        {label}
      </span>
      <code className="font-mono text-sm font-semibold">{value}</code>
    </div>
  );
}
