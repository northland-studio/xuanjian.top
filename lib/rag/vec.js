/**
 * sqlite-vec 扩展开关
 *
 * 进程内只需加载一次；加载失败时降级为「向量检索不可用」，
 * 由 Admin 明确展示，不允许把 FTS-only 伪装成混合检索。
 */
const db = require('../../database');

const state = {
    loaded: false,
    version: '',
    error: '',
    loadablePath: ''
};

async function load() {
    if (state.loaded) return state;
    try {
        const vec = require('sqlite-vec');
        const p = typeof vec.getLoadablePath === 'function' ? vec.getLoadablePath() : null;
        if (!p) throw new Error('sqlite-vec 未提供可加载路径');
        state.loadablePath = p;
        await new Promise((resolve, reject) => {
            db.db.loadExtension(p, (err) => (err ? reject(err) : resolve()));
        });
        const ver = await db.get('SELECT vec_version() AS v');
        state.version = (ver && ver.v) || '';
        state.loaded = true;
        state.error = '';
    } catch (e) {
        state.loaded = false;
        state.error = e && e.message ? e.message : String(e);
    }
    return state;
}

const isReady = () => state.loaded;

module.exports = { load, isReady, state };
