'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'meridian-theme';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState>({ theme: 'system', setTheme: () => {} });

export const useTheme = () => useContext(ThemeContext);

/**
 * Runs before paint, inline in <head>, so the correct theme is applied before the first
 * frame. Without it the page renders light, then snaps to dark once React hydrates —
 * a white flash on every navigation for dark-mode users.
 *
 * `system` deliberately stamps nothing: with no data-theme attribute the CSS falls
 * through to the prefers-color-scheme media query, so the OS stays in charge and changes
 * to it are picked up live.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === 'dark' || stored === 'light') setThemeState(stored);
    } catch {
      // Private browsing or blocked storage — the system preference still applies.
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY);
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem(STORAGE_KEY, next);
        document.documentElement.setAttribute('data-theme', next);
      }
    } catch {
      // Storage failures must not break the toggle; the attribute is still applied.
      if (next !== 'system') document.documentElement.setAttribute('data-theme', next);
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/** Three-state control rather than a binary switch, so "follow my OS" stays reachable. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the stored preference, so render a placeholder until mounted
  // rather than briefly highlighting the wrong option.
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-9 w-[104px]" aria-hidden />;

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-[var(--color-sunken)] p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={[
              'flex h-8 items-center justify-center rounded-[var(--radius-xs)] transition-all',
              compact ? 'w-8' : 'w-8',
              selected
                ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]',
            ].join(' ')}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
