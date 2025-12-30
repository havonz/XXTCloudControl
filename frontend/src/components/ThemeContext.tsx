import { createContext, useContext, createSignal, createEffect, ParentComponent, Accessor } from 'solid-js';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Accessor<Theme>;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>();

const THEME_STORAGE_KEY = 'xxt-cloud-theme';

export const ThemeProvider: ParentComponent = (props) => {
  // Initialize from localStorage or system preference
  const getInitialTheme = (): Theme => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  };

  const [theme, setThemeSignal] = createSignal<Theme>(getInitialTheme());

  const setTheme = (newTheme: Theme) => {
    setThemeSignal(newTheme);
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme() === 'light' ? 'dark' : 'light');
  };

  // Apply theme to document
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', theme());
  });

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
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
