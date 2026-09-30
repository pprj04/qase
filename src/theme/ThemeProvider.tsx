import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'qase-theme';

function resolveInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const applied = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return applied;
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => undefined,
  toggleTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  // Follow the OS preference live while the user has no persisted override
  // (mirrors the no-flash bootstrap script in index-react.html).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === 'light' || stored === 'dark') return; // explicit override wins
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t: Theme = mq.matches ? 'dark' : 'light';
      setThemeState(t);
      const root = document.documentElement;
      root.classList.toggle('dark', t === 'dark');
      root.style.colorScheme = t;
    };
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    const root = document.documentElement;
    root.classList.toggle('dark', t === 'dark');
    root.style.colorScheme = t;
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
