'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react';

/* ── Status ──────────────────────────────────────────────────────────────── */

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  CONFIRMED: { label: 'Confirmed', fg: 'var(--color-ok)', bg: 'var(--color-ok-soft)' },
  PENDING: { label: 'Pending', fg: 'var(--color-warn)', bg: 'var(--color-warn-soft)' },
  CANCELLED: { label: 'Cancelled', fg: 'var(--color-danger)', bg: 'var(--color-danger-soft)' },
  COMPLETED: { label: 'Completed', fg: 'var(--color-info)', bg: 'var(--color-info-soft)' },
  NO_SHOW: { label: 'No show', fg: 'var(--color-neutral)', bg: 'var(--color-neutral-soft)' },
  RESCHEDULED: { label: 'Moved', fg: 'var(--color-neutral)', bg: 'var(--color-neutral-soft)' },
};

/**
 * Status is the one place colour is allowed to carry meaning, so every status gets the
 * same treatment everywhere — a tinted pill with a solid dot. The dot matters: colour
 * alone is not an accessible signal, and the label does the real work for screen readers.
 */
export function StatusBadge({ status }: { status: string }) {
  const style = STATUS[status] ?? {
    label: status.toLowerCase(),
    fg: 'var(--color-neutral)',
    bg: 'var(--color-neutral-soft)',
  };
  return (
    <span className="badge" style={{ color: style.fg, background: style.bg }}>
      <span className="badge-dot" style={{ background: style.fg }} aria-hidden />
      {style.label}
    </span>
  );
}

/* ── Data states ─────────────────────────────────────────────────────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SlotSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, index) => (
        <Skeleton key={index} className="h-11" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden" aria-hidden="true">
      <div className="h-11 bg-[var(--color-sunken)] border-b border-[var(--color-line)]" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 h-14 border-b border-[var(--color-line)] last:border-0">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-28 hidden sm:block" />
          <Skeleton className="h-3.5 w-20 ml-auto" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-sunken)] text-[var(--color-ink-subtle)]">
          {icon}
        </div>
      ) : null}
      <p className="h3">{title}</p>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)] max-w-sm">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] p-4 flex gap-3"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-[var(--color-danger)]">Something went wrong</p>
        <p className="mt-1 text-sm text-[var(--color-ink)] break-words">{message}</p>
        {onRetry ? (
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />;
}

/* ── Stats ───────────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {icon ? (
          <span
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)]"
            style={{ background: accent ?? 'var(--color-sunken)', color: 'var(--color-ink-muted)' }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-[-0.02em] tabular">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">{hint}</p> : null}
    </div>
  );
}

/* ── Toasts ──────────────────────────────────────────────────────────────── */

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<(tone: ToastTone, message: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

/**
 * Toasts confirm that something happened without stealing focus. Deliberately transient
 * and never the only place an outcome is reported — anything that must be acted on gets
 * an inline message instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = (nextId.current += 1);
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);

  const tones: Record<ToastTone, { icon: ReactNode; fg: string; bg: string }> = {
    success: { icon: <Check size={15} />, fg: 'var(--color-ok)', bg: 'var(--color-ok-soft)' },
    error: {
      icon: <AlertTriangle size={15} />,
      fg: 'var(--color-danger)',
      bg: 'var(--color-danger-soft)',
    },
    info: { icon: <Info size={15} />, fg: 'var(--color-info)', bg: 'var(--color-info-soft)' },
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const tone = tones[toast.tone];
          return (
            <div
              key={toast.id}
              className="animate-slide-in card flex items-start gap-3 p-3 pr-2 shadow-[var(--shadow-lg)]"
            >
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ color: tone.fg, background: tone.bg }}
              >
                {tone.icon}
              </span>
              <p className="flex-1 text-sm leading-snug pt-0.5">{toast.message}</p>
              <button
                type="button"
                aria-label="Dismiss"
                className="btn-ghost h-7 w-7 p-0 shrink-0"
                onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Dialog ──────────────────────────────────────────────────────────────── */

/**
 * Modal with a focus trap, Escape to close, and a scroll lock. Written by hand rather
 * than pulled in as a dependency because the behaviour needed here is small and exact:
 * destructive confirmations must not be dismissable by accident.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus() ??
      panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;

      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-[var(--color-ink)]/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className="animate-rise relative w-full sm:max-w-md bg-white rounded-t-[var(--radius-lg)] sm:rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] outline-none"
      >
        <div className="p-5 sm:p-6">
          <h2 id="dialog-title" className="h2">
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{description}</p>
          ) : null}
          {children ? <div className="mt-5">{children}</div> : null}
        </div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-canvas)] p-4 rounded-b-[var(--radius-lg)]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Misc ────────────────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="h1">{title}</h1>
        {description ? <p className="lede mt-2 max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 p-0.5 bg-[var(--color-sunken)] rounded-[var(--radius-sm)]"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={[
              'h-8 px-3 text-[13px] font-semibold rounded-[var(--radius-xs)] transition-all',
              selected
                ? 'bg-white text-[var(--color-ink)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Debounces a value — used by search boxes so every keystroke is not a request. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);
  return matches;
}

export const currencyFormat = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);

export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return useMemo(() => mounted, [mounted]);
}
