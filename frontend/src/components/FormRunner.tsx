import { For, Show, createMemo, createRenderEffect, createSignal, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Select, createListCollection } from '@ark-ui/solid';
import { createFormRunnerStore } from '../services/formRunnerStore';
import { ConfigItem, ScriptInfo } from '../utils/scriptConfig';
import styles from './FormRunner.module.css';

interface FormRunnerProps {
  open?: boolean;
  title?: string;
  items: ConfigItem[];
  initialValues?: Record<string, any>;
  scriptInfo?: ScriptInfo | null;
  onSubmit: (values: Record<string, any>) => void;
  onClose?: () => void;
}

export default function FormRunner(props: FormRunnerProps) {
  const store = createFormRunnerStore();
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [formReady, setFormReady] = createSignal(false);

  createRenderEffect(() => {
    if (props.open) {
      setFormReady(false);
      store.initialize(props.items, props.initialValues);
      queueMicrotask(() => setFormReady(true));
    } else {
      setAboutOpen(false);
      setFormReady(false);
    }
  });

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
    const result = store.submit(props.items);
    props.onSubmit(result);
  };

  const getStringValue = (key: string) => (store.getValue<string>(key) ?? '');
  const getArrayValue = (key: string) => (store.getValue<string[]>(key) ?? []);

  const hasScriptInfo = createMemo(() => {
    const info = props.scriptInfo;
    if (!info) return false;
    return Boolean(info.Name || info.Developer || info.BuyLink || info.Instructions);
  });

  return (
    <Show when={props.open}>
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
              <span>{props.title || '脚本配置'}</span>
            </button>
            <div class={styles.headerActions}>
              <Show when={props.onClose}>
                <button type="button" class={styles.closeBtn} onClick={props.onClose}>
                  <span>✕</span>
                  <span>关闭</span>
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
                            <input
                              type="text"
                              placeholder={item.placeholder || '请输入'}
                              value={getStringValue(key)}
                              onInput={(e) => store.setValue(key, e.currentTarget.value)}
                            />
                          </Show>
                          
                          <Show when={item.type === 'ComboBox'}>
                            {(() => {
                              const collection = createMemo(() => createListCollection({ items: item.item }));
                              const current = () => getStringValue(key);
                              const value = () => current() ? [current()] : [];
                              return (
                                <Select.Root
                                  collection={collection()}
                                  value={value()}
                                  onValueChange={(e) => store.setValue(key, (e.items?.[0] as string) ?? '')}
                                >
                                  <Select.Control>
                                    <Select.Trigger class="cbx-select">
                                      <span>{current() || '-- 请选择 --'}</span>
                                      <span class="dropdown-arrow">▼</span>
                                    </Select.Trigger>
                                  </Select.Control>
                                  <Portal>
                                    <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                                      <Select.Content class="cbx-panel">
                                        <Select.ItemGroup>
                                          <For each={item.item}>{(opt) => (
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
                              const n = item.numPerLine || 1;
                              const cols = Math.max(1, n);
                              const gridStyle = `grid-template-columns: repeat(${cols}, minmax(0, 1fr));`;
                              const current = () => getArrayValue(key);
                              return (
                                <div class={styles.frGrid} style={gridStyle}>
                                  <For each={item.item}>{(opt) => {
                                    const active = () => current().includes(opt);
                                    const toggle = () => {
                                      store.setValue<string[]>(key, prev => {
                                        const next = Array.isArray(prev) ? [...prev] : [];
                                        const idx = next.indexOf(opt);
                                        if (idx >= 0) next.splice(idx, 1);
                                        else next.push(opt);
                                        return next;
                                      });
                                    };
                                    return (
                                      <div 
                                        class={`${styles.frSeg} ${styles.frSegCg} ${active() ? styles.active : ''}`} 
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
            <button type="button" onClick={handleSubmit}>保存配置</button>
          </div>
        </div>

        {/* About Dialog */}
        <Show when={aboutOpen()}>
          <Portal>
            <div class={styles.aboutBackdrop} onClick={() => setAboutOpen(false)}>
              <div class={styles.aboutModal} onClick={(e) => e.stopPropagation()}>
                <div class={styles.aboutHeader}>
                  <span class={styles.aboutTitle}>关于脚本</span>
                  <Show when={props.title}>
                    <span class={styles.aboutSubtitle}>{props.title}</span>
                  </Show>
                </div>
                <div class={styles.aboutContent}>
                  <Show when={props.scriptInfo?.Name}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>名称</span>
                      <span class={styles.aboutValue}>{props.scriptInfo?.Name}</span>
                    </div>
                  </Show>
                  <Show when={props.scriptInfo?.Developer}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>开发者</span>
                      <span class={styles.aboutValue}>{props.scriptInfo?.Developer}</span>
                    </div>
                  </Show>
                  <Show when={props.scriptInfo?.BuyLink}>
                    <div class={styles.aboutField}>
                      <span class={styles.aboutLabel}>购买链接</span>
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
                      <span class={styles.aboutLabel}>使用说明</span>
                      <div class={styles.aboutInstructions}>{props.scriptInfo?.Instructions}</div>
                    </div>
                  </Show>
                  <Show when={!hasScriptInfo()}>
                    <div class={styles.aboutEmpty}>暂无脚本信息</div>
                  </Show>
                </div>
              </div>
            </div>
          </Portal>
        </Show>
      </div>
    </Show>
  );
}
