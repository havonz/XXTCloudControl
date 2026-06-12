export interface ConfigItemBase {
  type: string;
  caption: string;
  id?: string;
  [key: string]: any;
}

export interface EditConfigItem extends ConfigItemBase {
  type: 'Edit';
  text?: string;
  placeholder?: string;
  nonEmpty?: boolean;
  validationRegex?: string;
  patternMessage?: string;
  allowMultiline?: boolean;
  visibleRows?: number;
}

export interface ComboBoxConfigItem extends ConfigItemBase {
  type: 'ComboBox';
  item: string[];
  select?: number;
  text?: string;
  canEdit?: boolean;
  nonEmpty?: boolean;
  validationRegex?: string;
  patternMessage?: string;
}

export type ConfigItem = ConfigItemBase | EditConfigItem | ComboBoxConfigItem;

export interface ScriptInfo {
  Name?: string;
  Version?: string;
  Developer?: string;
  BuyLink?: string;
  Instructions?: string;
}

export interface MainJson {
  UI?: ConfigItem[];
  Config?: Record<string, any>;
  ScriptInfo?: ScriptInfo;
  RunOptions?: {
    promptBeforeRun?: boolean;
    [key: string]: any;
  };
  [key: string]: any;
}

export function normalizeEditVisibleRows(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(12, Math.trunc(numeric)));
}

/**
 * Checks if a script's main.json indicates it is configurable
 */
export function checkScriptConfigurable(mainJson: MainJson | null | undefined): boolean {
  if (!mainJson) return false;
  
  // Must have UI items to be configurable
  const ui = mainJson.UI;
  if (!ui || !Array.isArray(ui) || ui.length === 0) {
    return false;
  }

  // Check if there are any input items (not just labels)
  const inputTypes = ['Edit', 'ComboBox', 'RadioGroup', 'CheckBoxGroup'];
  return ui.some(item => inputTypes.includes(item.type));
}
