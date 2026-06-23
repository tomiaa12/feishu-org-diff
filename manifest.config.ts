import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: "飞书-谁跑路了",
  version: pkg.version,
  icons: {
    16: 'public/16.png',
    32: 'public/32.png',
    48: 'public/48.png',
    128: 'public/128.png',
  },
  permissions: [
    'sidePanel',
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
