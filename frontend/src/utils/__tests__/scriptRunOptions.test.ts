import { describe, expect, it } from 'vitest';
import { normalizeEditVisibleRows } from '../scriptConfig';
import {
  findScriptConfigValidationIssues,
  getComboBoxEffectiveTextValue,
  shouldPromptForScriptConfig,
} from '../scriptRunOptions';

describe('scriptRunOptions', () => {
  it('对 Edit 空字符串执行 nonEmpty 校验', () => {
    const issues = findScriptConfigValidationIssues(
      [{ type: 'Edit', caption: '账号', nonEmpty: true }],
      { 账号: '' },
    );

    expect(issues).toEqual([{ kind: 'empty', caption: '账号' }]);
  });

  it('正则不匹配时保留自定义错误提示', () => {
    const issues = findScriptConfigValidationIssues(
      [{ type: 'Edit', caption: '账号', validationRegex: '[0-9]+', patternMessage: '账号必须是数字' }],
      { 账号: 'abc' },
    );

    expect(issues).toEqual([{ kind: 'regex_mismatch', caption: '账号', message: '账号必须是数字' }]);
  });

  it('空字符串也参与正则校验', () => {
    const issues = findScriptConfigValidationIssues(
      [{ type: 'Edit', caption: '账号', validationRegex: '.+' }],
      { 账号: '' },
    );

    expect(issues[0]?.kind).toBe('regex_mismatch');
  });

  it('拒绝明显不可移植的正则语法', () => {
    const issues = findScriptConfigValidationIssues(
      [{ type: 'Edit', caption: '账号', validationRegex: '(?=a)a' }],
      { 账号: 'a' },
    );

    expect(issues[0]?.kind).toBe('regex_unsupported');
  });

  it('仅在 ComboBox 允许自定义输入时执行文本校验', () => {
    const issues = findScriptConfigValidationIssues(
      [
        { type: 'ComboBox', caption: '模式', item: ['A'], canEdit: true, nonEmpty: true },
        { type: 'ComboBox', caption: '忽略', item: ['A'], canEdit: false, nonEmpty: true },
      ],
      { 模式: { select: 0, text: '' }, 忽略: 0 },
    );

    expect(issues).toEqual([{ kind: 'empty', caption: '模式' }]);
  });

  it('ComboBox 有选项序号时按选项文本校验', () => {
    const value = getComboBoxEffectiveTextValue(
      { type: 'ComboBox', caption: '模式', item: ['abc', '123'], canEdit: true },
      { 模式: 2 },
    );

    expect(value).toBe('123');
  });

  it('promptBeforeRun 或校验失败时需要弹配置', () => {
    expect(shouldPromptForScriptConfig({ RunOptions: { promptBeforeRun: true }, UI: [], Config: {} })).toBe(true);
    expect(shouldPromptForScriptConfig({
      UI: [{ type: 'Edit', caption: '账号', nonEmpty: true }],
      Config: { 账号: '' },
    })).toBe(true);
  });

  it('visibleRows 按 1 到 12 归一化', () => {
    expect(normalizeEditVisibleRows(undefined)).toBe(1);
    expect(normalizeEditVisibleRows(0)).toBe(1);
    expect(normalizeEditVisibleRows(4.8)).toBe(4);
    expect(normalizeEditVisibleRows(99)).toBe(12);
  });
});
