import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
  permissions: [
    'sidePanel',
    'contentSettings',
    'scripting',
    'tabs',
  ],
  host_permissions: [
    '*://*.feishu.cn/*',
  ],
  // content_scripts: [{
  //   js: ['src/content/main.tsx'],
  //   matches: ['https://*/*'],
  // }],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
})
