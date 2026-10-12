import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: process.env.SITE_ORIGIN || 'https://jvitorgallo-prog.github.io',
  base: process.env.SITE_BASE || '/memoria-zaniratti-galo',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
