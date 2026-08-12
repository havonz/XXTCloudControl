import { describe, expect, it } from 'vitest';
import { formatBatchRenameName, type BatchRenamePatternDevice } from '../batchRename';

const device: BatchRenamePatternDevice = {
  ip: '192.168.10.42',
  devname: '测试📱设备',
  devtype: 'iPhone15,2',
  sysversion: '18.1',
  zeversion: '5.2.0',
};

describe('formatBatchRenameName', () => {
  it('替换完整 IP、单段和区间', () => {
    expect(formatBatchRenameName('{ip}|{ip:4}|{ip:2..4}', device, 1))
      .toBe('192.168.10.42|42|168.10.42');
  });

  it('IP 倒序范围沿用局域网版语义并按升序输出', () => {
    expect(formatBatchRenameName('{ip:4..2}', device, 1)).toBe('168.10.42');
  });

  it('IP 缺少指定段时保留分隔位置', () => {
    expect(formatBatchRenameName('{ip:2..4}', { ip: '10.20' }, 1)).toBe('20..');
    expect(formatBatchRenameName('{ip}-{ip:4}', {}, 1)).toBe('-');
  });

  it('index 使用传入的列表行号而非选中项序号', () => {
    expect(formatBatchRenameName('设备-{index}', device, 37)).toBe('设备-37');
  });

  it('支持 index 的正负字符串切片', () => {
    expect(formatBatchRenameName('{index:1}-{index::2}-{index:-2}-{index:1:-1}', device, 12345))
      .toBe('2345-12-45-234');
  });

  it('按 Unicode 字符含端截取设备名', () => {
    expect(formatBatchRenameName('{devname:2,3}', device, 1)).toBe('试📱');
    expect(formatBatchRenameName('{devname:-1,-3}', device, 1)).toBe('📱设备');
  });

  it('设备名端点支持小数截断、零和越界钳制', () => {
    expect(formatBatchRenameName('{devname:2.9,99}', device, 1)).toBe('试📱设备');
    expect(formatBatchRenameName('{devname:0,1}', device, 1)).toBe('测试📱设备');
  });

  it('设备名截取参数缺失或无效时返回完整名称', () => {
    expect(formatBatchRenameName('{devname:2}', device, 1)).toBe(device.devname);
    expect(formatBatchRenameName('{devname:a,2}', device, 1)).toBe(device.devname);
  });

  it('替换设备型号和版本字段', () => {
    expect(formatBatchRenameName('{devtype}-{sysversion}-{zeversion}', device, 1))
      .toBe('iPhone15,2-18.1-5.2.0');
  });

  it('缺失字段替换为空字符串并替换所有重复占位符', () => {
    expect(formatBatchRenameName('{devname}/{devtype}/{sysversion}/{zeversion}/{devtype}', {}, 1))
      .toBe('////');
  });

  it('保留不受支持或格式错误的占位符', () => {
    expect(formatBatchRenameName('{ip:5}-{devname:}-{unknown}', device, 1))
      .toBe('{ip:5}-{devname:}-{unknown}');
  });
});
