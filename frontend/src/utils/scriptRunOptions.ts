import type { ComboBoxConfigItem, ConfigItem, EditConfigItem, MainJson } from './scriptConfig';
import { compilePortableValidationRegex } from './portableValidationRegex';

export type TextValidationIssueKind = 'empty' | 'regex_unsupported' | 'regex_invalid' | 'regex_mismatch';

export interface TextValidationIssue {
  kind: TextValidationIssueKind;
  caption: string;
  message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function getEditEffectiveValue(item: EditConfigItem, config: Record<string, any>): string {
  const caption = item.caption;
  if (caption && hasOwn(config, caption)) {
    const value = config[caption];
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : String(value);
  }
  return item.text ?? '';
}

function comboOptionText(item: ComboBoxConfigItem, index: number): string {
  const options = Array.isArray(item.item) ? item.item : [];
  return index > 0 && index <= options.length ? String(options[index - 1] ?? '') : '';
}

export function getComboBoxEffectiveTextValue(item: ComboBoxConfigItem, config: Record<string, any>): string {
  const caption = item.caption;
  if (caption && hasOwn(config, caption)) {
    const value = config[caption];
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return comboOptionText(item, value);
    if (isRecord(value)) {
      const select = value.select;
      if (typeof select === 'number' && select > 0) {
        return comboOptionText(item, select);
      }
      const text = value.text;
      return typeof text === 'string' ? text : '';
    }
    return String(value);
  }
  const select = item.select ?? 0;
  if (select > 0) return comboOptionText(item, select);
  return item.canEdit ? (item.text ?? '') : '';
}

export function getTextValidationValue(item: ConfigItem, config: Record<string, any>): string | null {
  if (item.type === 'Edit') {
    return getEditEffectiveValue(item as EditConfigItem, config);
  }
  if (item.type === 'ComboBox' && (item as ComboBoxConfigItem).canEdit === true) {
    return getComboBoxEffectiveTextValue(item as ComboBoxConfigItem, config);
  }
  return null;
}

export function validateTextConfigValue(item: EditConfigItem | ComboBoxConfigItem, value: string): TextValidationIssue | null {
  const caption = item.caption || '';
  if (item.nonEmpty === true && value === '') {
    return { kind: 'empty', caption };
  }

  const pattern = typeof item.validationRegex === 'string' ? item.validationRegex : '';
  if (!pattern) return null;

  const compiled = compilePortableValidationRegex(pattern);
  if (compiled.ok === false) {
    return {
      kind: compiled.error === 'unsupported' ? 'regex_unsupported' : 'regex_invalid',
      caption,
    };
  }
  if (!compiled.regex.test(value)) {
    return {
      kind: 'regex_mismatch',
      caption,
      message: item.patternMessage,
    };
  }
  return null;
}

export function findScriptConfigValidationIssues(items: ConfigItem[], config: Record<string, any>): TextValidationIssue[] {
  const issues: TextValidationIssue[] = [];
  for (const item of items) {
    if (item.type !== 'Edit' && item.type !== 'ComboBox') continue;
    const value = getTextValidationValue(item, config);
    if (value === null) continue;
    const issue = validateTextConfigValue(item as EditConfigItem | ComboBoxConfigItem, value);
    if (issue) issues.push(issue);
  }
  return issues;
}

export function buildEffectiveScriptConfig(mainJson: MainJson, override?: Record<string, any>): Record<string, any> {
  return {
    ...(isRecord(mainJson.Config) ? mainJson.Config : {}),
    ...(isRecord(override) ? override : {}),
  };
}

export function shouldPromptForScriptConfig(mainJson: MainJson, override?: Record<string, any>): boolean {
  if (mainJson.RunOptions?.promptBeforeRun === true) return true;
  const ui = Array.isArray(mainJson.UI) ? mainJson.UI : [];
  return findScriptConfigValidationIssues(ui, buildEffectiveScriptConfig(mainJson, override)).length > 0;
}
