import { useState, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { getCroppedImg } from '../utils/imageCrop';

/**
 * 图片裁剪选区器：选择图片后进入裁剪界面，支持拖拽/缩放选区
 * props:
 *  - file: 待裁剪图片文件（File）
 *  - aspect: 裁剪比例（如 1 头像、4/3 封面）
 *  - onCancel: 取消回调
 *  - onConfirm: 确认回调（返回裁剪后的 File）
 */
export default function ImageCropModal({ file, aspect = 1, onCancel, onConfirm }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [src, setSrc] = useState(null);
  const [pixelCrop, setPixelCrop] = useState(null);
  const [busy, setBusy] = useState(false);

  // 读取图片为 dataURL
  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSrc(reader.result);
    reader.readAsDataURL(file);
  }, [file]);

  // react-easy-crop 完成裁剪区域计算时回调（绝对像素）
  const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
    setPixelCrop(croppedAreaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!src || !pixelCrop || busy) return;
    setBusy(true);
    try {
      const croppedFile = await getCroppedImg(src, pixelCrop);
      onConfirm(croppedFile);
    } catch (e) {
      console.error('裁剪失败:', e);
      alert('裁剪失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>裁剪图片</h3>
        <p className="text-secondary" style={{ fontSize: 13, marginBottom: 12 }}>拖拽移动选区，滚动缩放图片</p>
        <div style={{ position: 'relative', width: '100%', height: 320, background: '#000', borderRadius: 10, overflow: 'hidden' }}>
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </div>
        <div className="flex" style={{ gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={busy}>
            {busy ? '处理中...' : '确认裁剪'}
          </button>
        </div>
      </div>
    </div>
  );
}
