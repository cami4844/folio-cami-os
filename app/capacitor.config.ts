import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.camios.folio',
  appName: 'Folio',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    backgroundColor: '#181612',
  },
  plugins: {
    Camera: {
      permissions: ['camera'],
    },
  },
};

export default config;
