export interface ConfigItem {
  type: string;
  caption: string;
  id?: string;
  [key: string]: any;
}

export interface ScriptInfo {
  Name?: string;
  Developer?: string;
  BuyLink?: string;
  Instructions?: string;
}

export interface MainJson {
  UI?: ConfigItem[];
  Config?: Record<string, any>;
  ScriptInfo?: ScriptInfo;
  [key: string]: any;
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
