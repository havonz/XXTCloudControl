import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://havonz.github.io',
  base: '/XXTCloudControl',
  output: 'static',
  integrations: [tailwind()]
});
