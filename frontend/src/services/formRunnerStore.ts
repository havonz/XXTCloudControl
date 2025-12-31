import { createStore, reconcile } from 'solid-js/store';
import { ConfigItem } from '../utils/scriptConfig';

export type FormRunnerInitialMap = Record<string, any>;

const keyOf = (item: ConfigItem, index: number): string => (
  item.id || item.caption || `__idx_${index}`
);

const computeInitialValue = (
  item: ConfigItem,
  index: number,
  initialByCaption: FormRunnerInitialMap | undefined
): [string, any] | null => {
  const key = keyOf(item, index);
  const caption = item.caption;
  const initByCaption = caption && initialByCaption ? initialByCaption[caption] : undefined;

  switch (item.type) {
    case 'Label':
      return null;
    case 'Edit': {
      if (typeof initByCaption === 'string') return [key, initByCaption];
      return [key, item.text ?? ''];
    }
    case 'ComboBox': {
      if (typeof initByCaption === 'string') return [key, initByCaption];
      if (initByCaption && typeof initByCaption === 'object') {
        const select = (initByCaption as any).select;
        const textValue = (initByCaption as any).text;
        if (typeof textValue === 'string' && (select === 0 || typeof select !== 'number')) {
          return [key, textValue];
        }
        if (typeof select === 'number' && select > 0 && select <= item.item.length) {
          return [key, item.item[select - 1]];
        }
      }
      if (typeof initByCaption === 'number' && initByCaption > 0 && initByCaption <= item.item.length) {
        return [key, item.item[initByCaption - 1]];
      }
      const idx = (item.select ?? 0) - 1;
      return [key, idx >= 0 && idx < item.item.length ? item.item[idx] : ''];
    }
    case 'RadioGroup': {
      if (typeof initByCaption === 'number' && initByCaption > 0 && initByCaption <= item.item.length) {
        return [key, item.item[initByCaption - 1]];
      }
      const idx = (item.select ?? 0) - 1;
      return [key, idx >= 0 && idx < item.item.length ? item.item[idx] : ''];
    }
    case 'CheckBoxGroup': {
      if (Array.isArray(initByCaption)) {
        const texts = (initByCaption as number[])
          .map(n => item.item[n - 1])
          .filter(Boolean);
        return [key, texts];
      }
      const indexes = item.select ?? [];
      return [key, indexes.map((ii: number) => item.item[ii - 1]).filter(Boolean)];
    }
    default:
      return [key, undefined];
  }
};

const buildInitialValues = (
  items: ConfigItem[],
  initialByCaption: FormRunnerInitialMap | undefined
): Record<string, any> => {
  const result: Record<string, any> = {};
  items.forEach((item, index) => {
    const pair = computeInitialValue(item, index, initialByCaption);
    if (pair) result[pair[0]] = pair[1];
  });
  return result;
};

const buildSubmitPayload = (items: ConfigItem[], values: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  items.forEach((item, index) => {
    if (!item.caption || item.type === 'Label') return;
    const key = keyOf(item, index);
    const value = values[key];
    switch (item.type) {
      case 'Edit':
        out[item.caption] = value ?? '';
        break;
      case 'ComboBox': {
        const strVal = String(value ?? '');
        const idx = item.item.indexOf(strVal);
        if (item.canEdit && idx < 0 && strVal !== '') {
          out[item.caption] = { select: 0, text: strVal };
        } else {
          out[item.caption] = idx >= 0 ? idx + 1 : 0;
        }
        break;
      }
      case 'RadioGroup': {
        const idx = item.item.indexOf(value as string);
        out[item.caption] = idx >= 0 ? idx + 1 : 0;
        break;
      }
      case 'CheckBoxGroup': {
        const arr = Array.isArray(value) ? (value as string[]) : [];
        const indexes = arr
          .map(text => item.item.indexOf(text))
          .filter(i => i >= 0)
          .map(i => i + 1);
        out[item.caption] = indexes;
        break;
      }
      default:
        break;
    }
  });
  return out;
};

export function createFormRunnerStore() {
  const [values, setValues] = createStore<Record<string, any>>({});

  const initialize = (items: ConfigItem[], initialByCaption?: FormRunnerInitialMap) => {
    const next = buildInitialValues(items, initialByCaption);
    setValues(reconcile(next));
  };

  const setValue = <T>(key: string, value: T | ((prev: T) => T)) => {
    if (typeof value === 'function') {
      setValues(key as any, value as (prev: T) => T);
    } else {
      setValues(key as any, value as T);
    }
  };

  const getValue = <T>(key: string): T | undefined => values[key];

  const submit = (items: ConfigItem[]) => buildSubmitPayload(items, values);

  return {
    values,
    initialize,
    setValue,
    getValue,
    submit,
    keyOf
  } as const;
}

export type FormRunnerStore = ReturnType<typeof createFormRunnerStore>;
