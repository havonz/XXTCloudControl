import { createContext, useContext, createSignal, JSX, Show } from 'solid-js';
import { GlobalDialog } from './GlobalDialog';

type DialogType = 'alert' | 'confirm' | 'prompt' | 'select';

interface DialogOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  options?: string[];
  confirmText?: string;
  cancelText?: string;
}

interface DialogState extends DialogOptions {
  type: DialogType;
  isOpen: boolean;
  resolve: (value: any) => void;
}

interface DialogContextType {
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
  select: (message: string, options: string[], defaultValue?: string, title?: string) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextType>();

export const DialogProvider = (props: { children: JSX.Element }) => {
  const [state, setState] = createSignal<DialogState>({
    type: 'alert',
    isOpen: false,
    message: '',
    resolve: () => {},
  });

  const showAlert = (message: string, title: string = '提示'): Promise<void> => {
    return new Promise((resolve) => {
      setState({
        type: 'alert',
        isOpen: true,
        title,
        message,
        resolve,
      });
    });
  };

  const showConfirm = (message: string, title: string = '确认'): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        type: 'confirm',
        isOpen: true,
        title,
        message,
        resolve,
      });
    });
  };

  const showPrompt = (message: string, defaultValue: string = '', title: string = '输入'): Promise<string | null> => {
    return new Promise((resolve) => {
      setState({
        type: 'prompt',
        isOpen: true,
        title,
        message,
        defaultValue,
        resolve,
      });
    });
  };

  const showSelect = (message: string, options: string[], defaultValue: string = '', title: string = '选择'): Promise<string | null> => {
    return new Promise((resolve) => {
      setState({
        type: 'select',
        isOpen: true,
        title,
        message,
        defaultValue,
        options,
        resolve,
      });
    });
  };

  const handleClose = (value: any) => {
    const currentState = state();
    setState({ ...currentState, isOpen: false });
    currentState.resolve(value);
  };

  return (
    <DialogContext.Provider value={{ alert: showAlert, confirm: showConfirm, prompt: showPrompt, select: showSelect }}>
      {props.children}
      <Show when={state().isOpen}>
        <GlobalDialog 
          type={state().type as any}
          title={state().title}
          message={state().message}
          defaultValue={state().defaultValue}
          options={state().options}
          onClose={handleClose}
        />
      </Show>
    </DialogContext.Provider>
  );
};

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
};
