# 玄剑公会 Android 版

基于 Capacitor + TypeScript + Vite 构建的移动端应用。

## 技术栈

- **Capacitor 7** - 跨平台原生运行时
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **CSS Variables** - 主题切换

## 功能特性

- 可收起侧边栏导航
- 暗色/亮色主题切换
- 日报、决策、贴吧浏览
- 通知系统
- 评论点赞功能
- 响应式设计

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 添加Android平台
npm run cap:add

# 同步到Android
npm run cap:sync

# 打开Android Studio
npm run cap:open
```

## 构建APK

1. 运行 `npm run build`
2. 运行 `npm run cap:sync`
3. 在 Android Studio 中构建 APK/AAB

## 图片上传

移动端图片上传使用 Capacitor Camera 插件，将 Base64 转换为 File 对象后上传：

```typescript
import { Camera, CameraResultType } from '@capacitor/camera';

const photo = await Camera.getPhoto({
  quality: 90,
  resultType: CameraResultType.Base64
});

// 将 Base64 转换为 Blob/File
const byteCharacters = atob(photo.base64String!);
const byteNumbers = new Array(byteCharacters.length);
for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
}
const byteArray = new Uint8Array(byteNumbers);
const blob = new Blob([byteArray], { type: 'image/jpeg' });

// 创建 File 对象并上传
const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
const formData = new FormData();
formData.append('image', file);

await fetch('/api/upload/image', {
    method: 'POST',
    body: formData
});
```

## 目录结构

```
apps/android/
├── src/
│   ├── assets/         # 静态资源
│   ├── config.ts       # 配置和类型定义
│   ├── main.ts         # 主入口
│   ├── styles.css      # 样式
│   └── vite-env.d.ts   # Vite类型
├── android/            # Android原生项目（cap add后生成）
├── index.html          # 入口HTML
├── package.json
├── tsconfig.json
├── vite.config.ts
└── capacitor.config.ts
```
