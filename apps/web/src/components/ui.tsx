import type { ReactNode } from 'react';

/**
 * The shared vocabulary of the interface.
 *
 * Kept small on purpose: a status badge, the three data states every screen needs, and a
 * page shell. Anything a screen needs beyond this is probably specific to that screen.
 */

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  CONFIRMED: {
    label: 'Confirmed',
    className: 'bg-[var(--color-confirmed-soft)] text-[var(--color-confirmed)]',
  },
  PENDING: {
    label: 'Pending',
    className: 'bg-[var(--color-pending-soft)] text-[var(--color-pending)]',
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'bg-[var(--color-cancelled-soft)] text-[var(--color-cancelled)]',
  },
  COMPLETED: {
    label: 'Completed',
    className: 'bg-[var(--color-completed-soft)] text-[var(--color-completed)]',
  },
  NO_SHOW: {
    label: 'No show',
    className: 'bg-[var(--color-noshow-soft)] text-[var(--color-noshow)]',
  },
  RESCHEDULED: {
    label: 'Rescheduled',
    className: 'bg-[var(--color-noshow-soft)] text-[var(--color-noshow)]',
  },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? {
    label: status,
    className: 'bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]',
  };
  return <span className={`badge ${style.className}`}>{style.label}</span>;
}

/** Skeletons rather than spinners: the page keeps its shape while data arrives. */
export function SlotSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="skeleton h-10" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-12 px-6">
      <p className="text-sm font-bold text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)] max-w-sm mx-auto">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="border border-[var(--color-cancelled)] bg-[var(--color-cancelled-soft)] rounded-[var(--radius-base)] p-4"
    >
      <p className="text-sm font-bold text-[var(--color-cancelled)]">Something went wrong</p>
      <p className="mt-1 text-sm text-[var(--color-ink)]">{message}</p>
      {onRetry ? (
        <button type="button" className="btn-secondary mt-3" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">{hint}</p> : null}
    </div>
  );
}
