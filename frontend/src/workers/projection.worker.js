/**
 * 投影文件解析 Worker：在后台线程完成 .litematic 的下载、NBT 解压与位解包（CPU 密集），
 * 结果以紧凑 NBT 字节流（compression: none）回传主线程，避免阻塞渲染线程。
 */
import { LitematicLoader } from '@mattzh72/lodestone';

self.onmessage = async (e) => {
  const { type, id, url } = e.data || {};
  if (type !== 'load') return;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`投影文件下载失败（HTTP ${resp.status}）`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const meta = LitematicLoader.getMetadata(buf);
    const structure = LitematicLoader.load(buf);
    const bytes = structure.writeNbt({ compression: 'none', name: meta.name || 'structure' });
    self.postMessage({ type: 'loaded', id, ok: true, meta, bytes: bytes.buffer }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ type: 'loaded', id, ok: false, error: String((err && err.message) || err) });
  }
};
