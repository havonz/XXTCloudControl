import { createContext, useContext, createSignal, createEffect, onCleanup, ParentComponent, Accessor } from 'solid-js';

export type Theme = 'light' | 'dark';
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Accessor<Theme>;
  themeMode: Accessor<ThemeMode>;
  setThemeMode: (mode: ThemeMode) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>();

const THEME_STORAGE_KEY = 'xxt-cloud-theme';

// Helper to get system preference
const getSystemTheme = (): Theme => {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

export const ThemeProvider: ParentComponent = (props) => {
  // Initialize from localStorage, default to 'system'
  const getInitialMode = (): ThemeMode => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
    return 'system';
  };

  const [themeMode, setThemeModeSignal] = createSignal<ThemeMode>(getInitialMode());
  const [systemTheme, setSystemTheme] = createSignal<Theme>(getSystemTheme());

  // Computed resolved theme based on mode
  const theme = (): Theme => {
    const mode = themeMode();
    if (mode === 'system') {
      return systemTheme();
    }
    return mode;
  };

  const setThemeMode = (newMode: ThemeMode) => {
    setThemeModeSignal(newMode);
    localStorage.setItem(THEME_STORAGE_KEY, newMode);
  };

  // Cycle through modes: system -> light -> dark -> system
  const cycleTheme = () => {
    const current = themeMode();
    if (current === 'system') {
      setThemeMode('light');
    } else if (current === 'light') {
      setThemeMode('dark');
    } else {
      setThemeMode('system');
    }
  };

  // Listen for system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemChange = (e: MediaQueryListEvent) => {
    setSystemTheme(e.matches ? 'dark' : 'light');
  };
  mediaQuery.addEventListener('change', handleSystemChange);

  onCleanup(() => {
    mediaQuery.removeEventListener('change', handleSystemChange);
  });

  // Apply theme to document
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', theme());
  });

  return (
    <ThemeContext.Provider value={{ theme, themeMode, setThemeMode, cycleTheme }}>
      {props.children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
