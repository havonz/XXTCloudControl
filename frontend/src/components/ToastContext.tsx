import { createContext, useContext, createSignal, JSX, Show, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType>();

export const ToastProvider = (props: { children: JSX.Element }) => {
  const [toast, setToast] = createSignal<ToastOptions | null>(null);
  const [isVisible, setIsVisible] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;

  const showToast = (message: string, type: ToastType = 'info', duration: number = 3000) => {
    if (timer) clearTimeout(timer);
    if (exitTimer) clearTimeout(exitTimer);
    
    setToast({ message, type, duration });
    setIsVisible(true);
    
    timer = setTimeout(() => {
      setIsVisible(false);
      exitTimer = setTimeout(() => {
        setToast(null);
      }, 300); // Wait for exit animation
    }, duration);
  };

  const showSuccess = (message: string, duration?: number) => showToast(message, 'success', duration);
  const showError = (message: string, duration?: number) => showToast(message, 'error', duration);
  const showWarning = (message: string, duration?: number) => showToast(message, 'warning', duration);
  const showInfo = (message: string, duration?: number) => showToast(message, 'info', duration);

  onCleanup(() => {
    if (timer) clearTimeout(timer);
    if (exitTimer) clearTimeout(exitTimer);
  });

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {props.children}
      <Portal>
        <Show when={toast()}>
          <div 
            class={`global-toast-container ${isVisible() ? 'visible' : 'exit'}`}
            style={{
              'border-left': `4px solid var(--${toast()?.type === 'error' ? 'danger' : toast()?.type})`
            }}
          >
            <div class="global-toast-icon">
              <Show when={toast()?.type === 'success'}>✓</Show>
              <Show when={toast()?.type === 'error'}>✕</Show>
              <Show when={toast()?.type === 'warning'}>⚠</Show>
              <Show when={toast()?.type === 'info'}>ℹ</Show>
            </div>
            <div class="global-toast-message">{toast()?.message}</div>
          </div>
        </Show>
      </Portal>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
