/* @refresh reload */
import { render } from 'solid-js/web';
import { ThemeProvider } from './components/ThemeContext';

import './index.css';
import App from './App';

const MOBILE_LAYOUT_MEDIA = '(max-width: 768px)';
const MOBILE_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

const setupMobileViewport = () => {
  const viewportMeta = document.getElementById('app-viewport');
  if (!(viewportMeta instanceof HTMLMetaElement)) {
    return;
  }

  const defaultViewportContent = viewportMeta.content;
  const mobileMedia = window.matchMedia(MOBILE_LAYOUT_MEDIA);
  const syncViewport = (matches = mobileMedia.matches) => {
    viewportMeta.content = matches ? MOBILE_VIEWPORT_CONTENT : defaultViewportContent;
  };
  const handleChange = (event?: MediaQueryListEvent) => {
    syncViewport(event?.matches);
  };

  syncViewport();

  if ('addEventListener' in mobileMedia) {
    mobileMedia.addEventListener('change', handleChange);
  } else {
    mobileMedia.addListener(handleChange);
  }
};

setupMobileViewport();

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
  );
}

import { DialogProvider } from './components/DialogContext';
import { ToastProvider } from './components/ToastContext';

render(() => (
  <ThemeProvider>
    <ToastProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ToastProvider>
  </ThemeProvider>
), root!);
