import { Component, For, createMemo } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
import { IconGlobe } from '../icons';
import { Locale, supportedLocales, useI18n } from '../i18n';
import styles from './LanguageSelect.module.css';

interface LanguageSelectProps {
  compact?: boolean;
  variant?: 'default' | 'login';
}

const LanguageSelect: Component<LanguageSelectProps> = (props) => {
  const { locale, setLocale, t } = useI18n();
  const isCompact = createMemo(() => props.compact || props.variant === 'login');
  const items = createMemo(() => supportedLocales.map(value => ({
    value,
    label: value === 'en-US' ? t('ui.language_en') : t('ui.language_zh'),
  })));
  const collection = createMemo(() => createListCollection({ items: items() }));
  const currentLabel = createMemo(() => items().find(item => item.value === locale())?.label || locale());
  const currentShortLabel = createMemo(() => locale() === 'en-US' ? 'EN' : '中');
  const triggerClass = createMemo(() => [
    'cbx-select',
    styles.trigger,
    isCompact() ? styles.compactTrigger : styles.regularTrigger,
    props.variant === 'login' ? styles.loginTrigger : '',
  ].filter(Boolean).join(' '));
  const panelWidth = createMemo(() => isCompact() ? '128px' : 'var(--reference-width)');

  return (
    <Select.Root
      collection={collection()}
      value={[locale()]}
      onValueChange={(event) => {
        const next = event.value[0] as Locale | undefined;
        if (next) setLocale(next);
      }}
    >
      <Select.Control>
        <Select.Trigger
          class={triggerClass()}
          aria-label={t('ui.language')}
          title={t('ui.language')}
        >
          <IconGlobe size={14} class={styles.icon} />
          <span class={styles.label}>{isCompact() ? currentShortLabel() : currentLabel()}</span>
          <span class={`dropdown-arrow ${styles.arrow}`}>▼</span>
        </Select.Trigger>
      </Select.Control>
      <Portal>
        <Select.Positioner style={{ 'z-index': 10200, width: panelWidth() }}>
          <Select.Content class="cbx-panel" style={{ width: panelWidth() }}>
            <Select.ItemGroup>
              <For each={items()}>{(item) => (
                <Select.Item item={item} class="cbx-item">
                  <div class="cbx-item-content">
                    <Select.ItemIndicator>✓</Select.ItemIndicator>
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </div>
                </Select.Item>
              )}</For>
            </Select.ItemGroup>
          </Select.Content>
        </Select.Positioner>
      </Portal>
      <Select.HiddenSelect />
    </Select.Root>
  );
};

export default LanguageSelect;
