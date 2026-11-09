import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gatecc.companion',
  appName: 'GATE Companion',
  webDir: 'dist',
  android: {
    minWebViewVersion: 96,
  },
};

export default config;
