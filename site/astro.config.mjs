import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

const DEFAULT_SITE_URL = 'https://xxtccc-releases.xxtouch.app';

function normalizeBase(value) {
  if (!value || value === '/') {
    return '/';
  }

  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
}

export default defineConfig({
  // 默认按自定义域名根路径构建，必要时仍可通过环境变量切回子路径部署。
  site: process.env.SITE_URL || DEFAULT_SITE_URL,
  base: normalizeBase(process.env.SITE_BASE),
  output: 'static',
  integrations: [tailwind()]
});
