import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICONS_DIR = path.join(__dirname, '..', 'src-tauri', 'icons');
const SOURCE_ICON = path.join(ICONS_DIR, 'icon.png');

// 定义需要的图标尺寸
const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
];

// Windows Store 图标尺寸
const storeSizes = [
  { name: 'Square30x30Logo.png', size: 30 },
  { name: 'Square44x44Logo.png', size: 44 },
  { name: 'Square71x71Logo.png', size: 71 },
  { name: 'Square89x89Logo.png', size: 89 },
  { name: 'Square107x107Logo.png', size: 107 },
  { name: 'Square142x142Logo.png', size: 142 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square284x284Logo.png', size: 284 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'StoreLogo.png', size: 50 },
];

// ICO 文件需要的尺寸
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

async function generateIcon(inputPath, outputPath, size) {
  try {
    await sharp(inputPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outputPath);
    console.log(`Generated: ${path.basename(outputPath)} (${size}x${size})`);
  } catch (error) {
    console.error(`Error generating ${outputPath}:`, error);
  }
}

async function generateICO() {
  console.log('\nGenerating icon.ico...');
  try {
    // 生成各种尺寸的PNG用于ICO
    const tempDir = path.join(ICONS_DIR, 'temp_ico');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const pngFiles = [];
    for (const size of icoSizes) {
      const pngPath = path.join(tempDir, `icon_${size}.png`);
      await sharp(SOURCE_ICON)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(pngPath);
      pngFiles.push(pngPath);
    }

    // 使用 png-to-ico 生成真正的 ICO 文件
    const icoPath = path.join(ICONS_DIR, 'icon.ico');
    const icoBuffer = await pngToIco(pngFiles);
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('Generated: icon.ico (multi-size)');

    // 清理临时文件
    for (const file of pngFiles) {
      fs.unlinkSync(file);
    }
    fs.rmdirSync(tempDir);

  } catch (error) {
    console.error('Error generating icon.ico:', error);
  }
}

async function generateICNS() {
  console.log('\nGenerating icon.icns...');
  try {
    const icnsPath = path.join(ICONS_DIR, 'icon.icns');

    // 生成 512x512 图标
    const png512Path = path.join(ICONS_DIR, 'icon_512.png');
    await sharp(SOURCE_ICON)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(png512Path);

    fs.copyFileSync(png512Path, icnsPath);
    fs.unlinkSync(png512Path);
    console.log('Generated: icon.icns (512x512 PNG format)');

  } catch (error) {
    console.error('Error generating icon.icns:', error);
  }
}

async function main() {
  console.log('Generating icons from:', SOURCE_ICON);

  if (!fs.existsSync(SOURCE_ICON)) {
    console.error('Source icon not found:', SOURCE_ICON);
    process.exit(1);
  }

  // 生成标准图标
  for (const { name, size } of sizes) {
    const outputPath = path.join(ICONS_DIR, name);
    await generateIcon(SOURCE_ICON, outputPath, size);
  }

  // 生成 Windows Store 图标
  for (const { name, size } of storeSizes) {
    const outputPath = path.join(ICONS_DIR, name);
    await generateIcon(SOURCE_ICON, outputPath, size);
  }

  // 生成 ICO 文件
  await generateICO();

  // 生成 ICNS 文件
  await generateICNS();

  console.log('\n✅ All icons generated successfully!');
}

main().catch(console.error);
