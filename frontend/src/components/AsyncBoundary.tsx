import { ErrorBoundary, Show, Suspense, type JSX } from 'solid-js';
import { useI18n } from '../i18n';
import LoadingState from './LoadingState';

export default function AsyncBoundary(props: {
  children: JSX.Element;
  modal?: boolean;
  visible?: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  return (
    <ErrorBoundary fallback={
      <Show when={props.visible !== false}>
        <LoadingState
          error
          modal={props.modal}
          message={t('common.load_failed')}
          refreshLabel={t('common.refresh')}
          closeLabel={t('common.close')}
          onClose={props.onClose}
        />
      </Show>
    }>
      <Suspense fallback={
        <Show when={props.visible !== false}>
          <LoadingState
            modal={props.modal}
            message={t('common.loading')}
            closeLabel={t('common.close')}
            onClose={props.onClose}
          />
        </Show>
      }>
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}
