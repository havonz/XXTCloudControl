import { beforeAll } from 'vitest';
import { loadLocaleMessages, supportedLocales } from '../index';

// 普通组件测试直接进入可交互状态，冷加载和切换竞态由独立用例覆盖。
beforeAll(async () => {
  await Promise.all(supportedLocales.map(loadLocaleMessages));
});
