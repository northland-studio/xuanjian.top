/**
 * 核销码二维码（**浏览器本地生成**）
 *
 * 为什么不在服务端出图：核销码明文只在「下单成功」与「重新生成」时返回一次，
 * 服务端只保存 sha256 哈希与末四位，根本没有明文可以画成二维码。
 * 因此这里在买家浏览器里本地生成，明文只在本机内存与屏幕上出现，不回传服务端。
 *
 * 二维码内容与商家页行为见 market/verify-code.js：
 *   <站点>/market/merchant?store_id=<店铺>&code=<核销码>
 * 商家用手机扫码即可打开核销台并自动填入核销码，不用手抄（手抄过一次就抄错过）。
 * 商家页拿到 code 参数后只做「预填 + 聚焦」，必须自己再点一次核销，不会自动扣款。
 */
import { useEffect, useState } from 'react';
import { isFullVerifyCode, verifyScanUrl } from '../market/verify-code';

export default function MarketCodeQr({ code, storeId = null, size = 176, className = 'mk-code-qr' }) {
  const [dataUrl, setDataUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const ok = isFullVerifyCode(code);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setDataUrl('');
    if (!isFullVerifyCode(code)) return () => { alive = false; };
    // 动态引入：qrcode 的 package.json 里 browser 字段指向浏览器构建（不会打进 SSR 产物）
    import('qrcode')
      .then((mod) => (mod.default || mod).toDataURL(verifyScanUrl(code, storeId), {
        margin: 1, width: size * 2, errorCorrectionLevel: 'M',
        color: { dark: '#1b1035', light: '#ffffff' }
      }))
      .then((url) => { if (alive) setDataUrl(url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [code, storeId, size]);

  if (!ok) return null;
  if (failed) {
    return <div className="mk-note" style={{ marginTop: 8 }}>二维码生成失败，请把上面的核销码直接发给商家</div>;
  }
  if (!dataUrl) return <div className={className} style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <img
      className={className}
      width={size}
      height={size}
      src={dataUrl}
      alt="核销码二维码（商家扫码打开核销台）"
      title="商家用手机扫码可直接打开核销台并填入此码"
    />
  );
}
