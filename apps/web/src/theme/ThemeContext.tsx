import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet } from '../lib/api';

// See docs/adr/0042-tenant-theme-system.md. 'middle' is the default: the bare
// document (no data-theme attribute) already renders it via index.css's :root
// block, so this context starting at 'middle' before the fetch below
// resolves is already correct for most tenants, not just a placeholder.
export type UiTheme = 'middle' | 'refined';

interface ThemeContextValue {
  theme: UiTheme;
  /** Applies immediately (sets the DOM attribute + this context value) -- persisting it is the caller's job. */
  applyTheme: (theme: UiTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function applyThemeToDocument(theme: UiTheme) {
  if (theme === 'refined') {
    document.documentElement.dataset.theme = 'refined';
  } else {
    delete document.documentElement.dataset.theme;
  }
}

// The fetch lives here, not in Layout.tsx, deliberately: a value loaded async
// and then handed down as a prop can't just seed useState's initial value --
// that argument is only read on the very first render, so a prop update
// after the fetch resolves would never actually reach this state. Fetching
// where the state itself lives avoids that trap entirely.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<UiTheme>('middle');

  useEffect(() => {
    apiGet<{ theme: UiTheme }>('/ui-settings')
      .then(({ theme: fetched }) => {
        applyThemeToDocument(fetched);
        setTheme(fetched);
      })
      .catch(() => {});
  }, []);

  function applyTheme(next: UiTheme) {
    applyThemeToDocument(next);
    setTheme(next);
  }

  return <ThemeContext.Provider value={{ theme, applyTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider (i.e. inside an authenticated route under Layout)');
  return ctx;
}
