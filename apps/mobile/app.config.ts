import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: 'FitMind',
  slug: 'fitmind-personal',
  scheme: 'fitmind',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: 'com.fitmind.personal',
    supportsTablet: false,
    infoPlist: {
      NSLocalNetworkUsageDescription: '连接你个人电脑上的健身数据服务。',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  web: { output: 'single' as any, name: 'FitMind' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission: '选择食物与营养标签照片用于记录。',
        cameraPermission: '拍摄食物与营养标签照片。',
        microphonePermission: false,
      },
    ],
    [
      'expo-audio',
      { microphonePermission: '录下你的健身记录并转写为可编辑文字。' },
    ],
    ['expo-notifications', { color: '#00ED85' }],
  ],
  experiments: { typedRoutes: false },
};
export default config;
