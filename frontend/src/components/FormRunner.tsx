import { For, Show, createMemo, createRenderEffect, createSignal, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Combobox, Select, createListCollection } from '@ark-ui/solid';
import { createFormRunnerStore } from '../services/formRunnerStore';
import { CheckBoxGroupConfigItem, ComboBoxConfigItem, ConfigItem, EditConfigItem, ScriptInfo, normalizeEditVisibleRows } from '../utils/scriptConfig';
import { validateTextConfigValue, type TextValidationIssue } from '../utils/scriptRunOptions';
import { orderedCheckBoxIndexes, selectedTextIndexes } from '../utils/checkboxGroupOrder';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import { useI18n } from '../i18n';
import styles from './FormRunner.module.css';

interface FormRunnerProps {
  open?: boolean;
  title?: string;
  items: ConfigItem[];
  initialValues?: Record<string, any>;
  scriptInfo?: ScriptInfo | null;
  onSubmit: (values: Record<string, any>) => void;
  onClose?: () => void;
  submitLabel?: string;
  validateOnOpen?: boolean;
}

type ChoiceRects = Map<string, DOMRect>;

const shouldReduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

const captureChoiceRects = (grid: HTMLElement | undefined): ChoiceRects | undefined => {
  if (!grid || shouldReduceMotion()) return undefined;
  const rects: ChoiceRects = new Map();
  grid.querySelectorAll<HTMLElement>('[data-choice-key]').forEach((element) => {
    const key = element.dataset.choiceKey;
    if (key) rects.set(key, element.getBoundingClientRect());
  });
  return rects;
};

const playChoiceOrderAnimation = (grid: HTMLElement | undefined, firstRects: ChoiceRects | undefined) => {
  if (!grid || !firstRects || shouldReduceMotion()) return;
  requestAnimationFrame(() => {
    grid.querySelectorAll<HTMLElement>('[data-choice-key]').forEach((element) => {
      const key = element.dataset.choiceKey;
      const first = key ? firstRects.get(key) : undefined;
      if (!first) return;
      const last = element.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      element.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0, 0)' }
        ],
        { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      );
    });
  });
};

export default function FormRunner(props: FormRunnerProps) {
  const { t } = useI18n();
  const store = createFormRunnerStore();
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [formReady, setFormReady] = createSignal(false);
  const [validationErrors, setValidationErrors] = createSignal<Record<string, string>>({});
  const aboutBackdropClose = createBackdropClose(() => setAboutOpen(false));

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (aboutOpen()) {
        setAboutOpen(false);
      } else if (props.open && props.onClose) {
        props.onClose();
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  const handleSubmit = () => {
    const errors = validateValues();
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const result = store.submit(props.items);
    props.onSubmit(result);
  };

  const getStringValue = (key: string) => (store.getValue<string>(key) ?? '');
  const getArrayValue = (key: string) => (store.getValue<string[]>(key) ?? []);

  const formatValidationIssue = (issue: TextValidationIssue): string => {
    switch (issue.kind) {
      case 'empty':
        return t('form.non_empty_error');
      case 'regex_unsupported':
        return t('form.validation_regex_unsupported');
      case 'regex_invalid':
        return t('form.validation_regex_invalid');
      case 'regex_mismatch':
        return issue.message || t('form.validation_regex_mismatch');
      default:
        return t('form.validation_regex_mismatch');
    }
  };

  const validateValues = (): Record<string, string> => {
    const next: Record<string, string> = {};
    props.items.forEach((item, index) => {
      if (item.type !== 'Edit' && item.type !== 'ComboBox') return;
      if (item.type === 'ComboBox' && (item as ComboBoxConfigItem).canEdit !== true) return;
      const key = store.keyOf(item, index);
      const issue = validateTextConfigValue(item as EditConfigItem | ComboBoxConfigItem, getStringValue(key));
      if (issue) {
        next[key] = formatValidationIssue(issue);
      }
    });
    return next;
  };

  const clearValidationError = (key: string) => {
    if (!validationErrors()[key]) return;
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  createRenderEffect(() => {
    if (props.open) {
      setFormReady(false);
      store.initialize(props.items, props.initialValues);
      setValidationErrors(props.validateOnOpen ? validateValues() : {});
      queueMicrotask(() => setFormReady(true));
    } else {
      setAboutOpen(false);
      setFormReady(false);
      setValidationErrors({});
    }
  });

  const hasScriptInfo = createMemo(() => {
    const info = props.scriptInfo;
    if (!info) return false;
    return Boolean(info.Name || info.Version || info.Developer || info.BuyLink || info.Instructions);
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div class={styles.backdrop}>
          <div class={styles.modal}>
            {/* Header */}
            <div class={styles.header}>
              <button 
                type="button" 
                class={styles.titleButton} 
                onClick={() => hasScriptInfo() && setAboutOpen(true)}
                style={{ cursor: hasScriptInfo() ? 'pointer' : 'default' }}
              >
                <span>{props.title || t('form.script_config')}</span>
              </button>
              <div class={styles.headerActions}>
                <Show when={props.onClose}>
                  <button type="button" class={styles.closeButton} onClick={props.onClose}>
                    <IconXmark size={16} />
                  </button>
                </Show>
              </div>
            </div>
            
            {/* Content - scrollable area */}
            <div class={styles.content}>
              <div class={styles.scrollArea}>
                <div class={styles.itemList}>
                  <Show when={formReady()}>
                    <For each={props.items}>
                      {(item, index) => {
                        const key = store.keyOf(item, index());
                        
                        return (
                          <div class={styles.field}>
                            <Show when={item.caption && item.type !== 'Label'}>
                              <label class={styles.fieldLabel}>{item.caption}</label>
                            </Show>
                            
                            <Show when={item.type === 'Label'}>
                              <div class={styles.labelText} style={{ "text-align": item.align || 'left' }}>
                                {item.caption}
                              </div>
                            </Show>
                            
                            <Show when={item.type === 'Edit'}>
                              {(() => {
                                const edit = item as EditConfigItem;
                                const handleInput = (value: string) => {
                                  store.setValue(key, value);
                                  clearValidationError(key);
                                };
                                if (edit.allowMultiline) {
                                  return (
                                    <textarea
                                      placeholder={edit.placeholder || t('form.input_placeholder')}
                                      value={getStringValue(key)}
                                      rows={normalizeEditVisibleRows(edit.visibleRows)}
                                      aria-invalid={validationErrors()[key] ? 'true' : 'false'}
                                      onInput={(e) => handleInput(e.currentTarget.value)}
                                    />
                                  );
                                }
                                return (
                                  <input
                                    type="text"
                                    placeholder={edit.placeholder || t('form.input_placeholder')}
                                    value={getStringValue(key)}
                                    aria-invalid={validationErrors()[key] ? 'true' : 'false'}
                                    onInput={(e) => handleInput(e.currentTarget.value)}
                                  />
                                );
                              })()}
                              <Show when={validationErrors()[key]}>
                                <div class={styles.validationError}>{validationErrors()[key]}</div>
                              </Show>
                            </Show>
                            
                            <Show when={item.type === 'ComboBox'}>
                              {(() => {
                                const combo = item as ComboBoxConfigItem;
                                const options = Array.isArray(combo.item) ? combo.item : [];
                                const collection = createMemo(() => createListCollection({ items: options }));
                                const current = () => getStringValue(key);
                                const value = () => current() ? [current()] : [];
                                const handleValue = (next: string) => {
                                  store.setValue(key, next);
                                  clearValidationError(key);
                                };
                                if (combo.canEdit) {
                                  return (
                                    <>
                                      <Combobox.Root
                                        collection={collection()}
                                        inputValue={current()}
                                        value={options.includes(current()) ? value() : []}
                                        allowCustomValue
                                        openOnClick
                                        invalid={!!validationErrors()[key]}
                                        onInputValueChange={(e) => handleValue(e.inputValue)}
                                        onValueChange={(e) => handleValue(String((e.items?.[0] ?? e.value?.[0] ?? '') as string))}
                                      >
                                        <Combobox.Control class="cbx">
                                          <Combobox.Input
                                            class="cbx-input"
                                            placeholder={t('form.select_placeholder')}
                                          />
                                          <Combobox.Trigger class="cbx-trigger">▼</Combobox.Trigger>
                                        </Combobox.Control>
                                        <Portal>
                                          <Combobox.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                                            <Combobox.Content class="cbx-panel">
                                              <Combobox.ItemGroup>
                                                <For each={options}>{(opt) => (
                                                  <Combobox.Item item={opt} class="cbx-item">
                                                    <div class="cbx-item-content">
                                                      <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
                                                      <Combobox.ItemText>{opt}</Combobox.ItemText>
                                                    </div>
                                                  </Combobox.Item>
                                                )}</For>
                                              </Combobox.ItemGroup>
                                            </Combobox.Content>
                                          </Combobox.Positioner>
                                        </Portal>
                                      </Combobox.Root>
                                      <Show when={validationErrors()[key]}>
                                        <div class={styles.validationError}>{validationErrors()[key]}</div>
                                      </Show>
                                    </>
                                  );
                                }
                                return (
                                  <Select.Root
                                    collection={collection()}
                                    value={value()}
                                    onValueChange={(e) => handleValue((e.items?.[0] as string) ?? '')}
                                  >
                                    <Select.Control>
                                      <Select.Trigger class="cbx-select">
                                        <span>{current() || t('form.select_placeholder')}</span>
                                        <span class="dropdown-arrow">▼</span>
                                      </Select.Trigger>
                                    </Select.Control>
                                    <Portal>
                                      <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                                        <Select.Content class="cbx-panel">
                                          <Select.ItemGroup>
                                            <For each={options}>{(opt) => (
                                              <Select.Item item={opt} class="cbx-item">
                                                <div class="cbx-item-content">
                                                  <Select.ItemIndicator>✓</Select.ItemIndicator>
                                                  <Select.ItemText>{opt}</Select.ItemText>
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
                              })()}
                            </Show>
                            
                            <Show when={item.type === 'RadioGroup'}>
                              {(() => {
                                const n = item.numPerLine || 1;
                                const cols = Math.max(1, n);
                                const gridStyle = `grid-template-columns: repeat(${cols}, minmax(0, 1fr));`;
                                const current = () => getStringValue(key);
                                return (
                                  <div class={styles.frGrid} style={gridStyle}>
                                    <For each={item.item}>{(opt) => {
                                      const active = () => current() === opt;
                                      const onClick = () => store.setValue(key, opt);
                                      return (
                                        <div 
                                          class={`${styles.frSeg} ${styles.frSegRg} ${active() ? styles.active : ''}`} 
                                          role="button" 
                                          onClick={onClick}
                                        >
                                          {opt}
                                        </div>
                                      );
                                    }}</For>
                                  </div>
                                );
                              })()}
                            </Show>
                            
                            <Show when={item.type === 'CheckBoxGroup'}>
                              {(() => {
                                const group = item as CheckBoxGroupConfigItem;
                                const n = item.numPerLine || 1;
                                const cols = Math.max(1, n);
                                const gridStyle = `grid-template-columns: repeat(${cols}, minmax(0, 1fr));`;
                                const current = () => getArrayValue(key);
                                const currentIndexes = () => selectedTextIndexes(group.item, current());
                                const visibleIndexes = () => orderedCheckBoxIndexes(group.item.length, currentIndexes(), group.orderedSelection);
                                let gridRef: HTMLDivElement | undefined;
                                return (
                                  <div ref={(el) => { gridRef = el; }} class={styles.frGrid} style={gridStyle}>
                                    <For each={visibleIndexes()}>{(optionIndex) => {
                                      const opt = group.item[optionIndex - 1] ?? '';
                                      const active = () => current().includes(opt);
                                      const toggle = () => {
                                        const firstRects = group.orderedSelection ? captureChoiceRects(gridRef) : undefined;
                                        store.setValue<string[]>(key, prev => {
                                          const next = Array.isArray(prev) ? [...prev] : [];
                                          const idx = next.indexOf(opt);
                                          if (idx >= 0) next.splice(idx, 1);
                                          else next.push(opt);
                                          return next;
                                        });
                                        playChoiceOrderAnimation(gridRef, firstRects);
                                      };
                                      return (
                                        <div 
                                          class={`${styles.frSeg} ${styles.frSegCg} ${active() ? styles.active : ''}`} 
                                          data-choice-key={String(optionIndex)}
                                          role="button" 
                                          onClick={toggle}
                                        >
                                          {opt}
                                        </div>
                                      );
                                    }}</For>
                                  </div>
                                );
                              })()}
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div class={styles.footer}>
              <button type="button" onClick={handleSubmit}>{props.submitLabel || t('form.save_config')}</button>
            </div>
          </div>

          {/* About Dialog */}
          <Show when={aboutOpen()}>
            <div class={styles.aboutBackdrop} onMouseDown={aboutBackdropClose.onMouseDown} onMouseUp={aboutBackdropClose.onMouseUp}>
              <div class={styles.aboutModal} onMouseDown={(e) => e.stopPropagation()}>
                <div class={styles.aboutHeader}>
                  <span class={styles.aboutTitle}>{t('form.about_script')}</span>
                  <Show when={props.title}>
                    <span class={styles.aboutSubtitle}>{props.title}</span>
                  </Show>
                </div>
                <div class={styles.aboutContent}>
                  <Show when={props.scriptInfo?.Name}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>{t('form.name')}</span>
                      <span class={styles.aboutValue}>{props.scriptInfo?.Name}</span>
                    </div>
                  </Show>
                  <Show when={props.scriptInfo?.Version}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>{t('form.version')}</span>
                      <span class={styles.aboutValue}>{props.scriptInfo?.Version}</span>
                    </div>
                  </Show>
                  <Show when={props.scriptInfo?.Developer}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>{t('form.developer')}</span>
                      <span class={styles.aboutValue}>{props.scriptInfo?.Developer}</span>
                    </div>
                  </Show>
                  <Show when={props.scriptInfo?.BuyLink}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>{t('form.purchase_url')}</span>
                      <a 
                        class={styles.aboutLink} 
                        href={props.scriptInfo?.BuyLink} 
                        target="_blank" 
                        rel="noopener noreferrer"
                      >
                        {props.scriptInfo?.BuyLink}
                      </a>
                    </div>
                  </Show>
                  <Show when={props.scriptInfo?.Instructions}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>{t('form.usage')}</span>
                      <div class={styles.aboutInstructions}>{props.scriptInfo?.Instructions}</div>
                    </div>
                  </Show>
                  <Show when={!hasScriptInfo()}>
                    <div class={styles.aboutEmpty}>{t('form.empty')}</div>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Portal>
    </Show>
  );
}
