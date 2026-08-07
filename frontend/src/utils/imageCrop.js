// 图片裁剪工具：根据 react-easy-crop 的 pixelCrop 输出裁剪后的图片 File

function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.src = url;
  });
}

/**
 * 从 dataURL 图片按 pixelCrop（绝对像素区域）裁剪，返回裁剪后的 File
 * @param {string} imageSrc - 原始图片 dataURL
 * @param {{x:number,y:number,width:number,height:number}} pixelCrop - 裁剪像素区域（react-easy-crop onCropComplete）
 * @param {number} rotation - 旋转角度（度数，默认 0）
 * @returns {Promise<File>}
 */
export async function getCroppedImg(imageSrc, pixelCrop, rotation = 0) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const rotRad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rotRad));
  const sin = Math.abs(Math.sin(rotRad));

  // 旋转后的画布尺寸
  const canvasW = Math.ceil(pixelCrop.width * cos + pixelCrop.height * sin);
  const canvasH = Math.ceil(pixelCrop.width * sin + pixelCrop.height * cos);
  canvas.width = canvasW;
  canvas.height = canvasH;

  ctx.save();
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.rotate(rotRad);
  ctx.translate(-pixelCrop.x - pixelCrop.width / 2, -pixelCrop.y - pixelCrop.height / 2);
  ctx.drawImage(image, 0, 0);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas 为空'));
        return;
      }
      const file = new File([blob], `cropped-${Date.now()}.png`, { type: 'image/png' });
      resolve(file);
    }, 'image/png');
  });
}
