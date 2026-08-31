import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { resolveLocalDeviceMessage } from '../deviceMessage';

describe('local device messages', () => {
  it('保留语义键后可在 TTL 内直接切换显示语言', () => {
    const message = {
      code: 'device_list.msg_setting_brightness',
      params: { value: 60 },
    };

    expect(resolveLocalDeviceMessage(message, (key, vars) => translate('zh-CN', key, vars)))
      .toBe('正在设置亮度: 60%...');
    expect(resolveLocalDeviceMessage(message, (key, vars) => translate('en-US', key, vars)))
      .toBe('Setting brightness: 60%...');
  });

  it('本地缺少键时保留原始回退文案', () => {
    expect(resolveLocalDeviceMessage(
      { code: 'third_party.error', fallback: 'raw device error' },
      key => key,
    )).toBe('raw device error');
  });
});
