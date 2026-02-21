import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'top.xuanjian.android',
  appName: '玄剑公会',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    Camera: {
      permissions: ['camera', 'photos']
    }
  }
};

export default config;
