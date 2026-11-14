/**
 * GIS 对象属性面板：属性编辑、几何顶点编辑提示、Wiki 关联、版本历史与审核动作。
 *
 * 说明：前端按钮只是体验层，所有写操作后端都会用 requirePermission 独立鉴权。
 */
import { useEffect, useMemo, useState } from 'react';

const ROAD_LEVELS = [1, 2, 3, 4, 5];
const ROAD_TYPES = [
    { key: 'road', label: '道路' }, { key: 'street', label: '街道' }, { key: 'path', label: '小径' },
    { key: 'highway', label: '高速/主干' }, { key: 'bridge', label: '桥梁' }, { key: 'tunnel', label: '隧道' }, { key: 'other', label: '其他' }
];
const DISTRICT_TYPES = [
    { key: 'city', label: '城市' }, { key: 'district', label: '城区' }, { key: 'zone', label: '区域' },
    { key: 'region', label: '大区' }, { key: 'other', label: '其他' }
];

const STATUS_LABEL = {
    DRAFT: '草稿', REVIEW: '待审核', PUBLISHED: '已发布', REJECTED: '已驳回', ARCHIVED: '已归档'
};
const STATUS_BADGE = {
    DRAFT: 'badge', REVIEW: 'badge badge-warning', PUBLISHED: 'badge badge-success', REJECTED: 'badge badge-danger', ARCHIVED: 'badge'
};

function initialForm(object) {
    if (!object) return null;
    const base = {
        name: object.name || '',
        description: object.description || '',
        wikiPageId: object.wikiPageId === null || object.wikiPageId === undefined ? '' : String(object.wikiPageId),
        revision: object.revision
    };
    if (object.type === 'marker') {
        return { ...base, category: object.category || 'other', x: object.point?.x ?? 0, y: object.point?.y ?? 64, z: object.point?.z ?? 0 };
    }
    if (object.type === 'road') {
        return {
            ...base, width: object.width || 5, roadLevel: object.roadLevel || 3, isMain: !!object.isMain,
            roadType: object.roadType || 'road', districtId: object.districtId ? String(object.districtId) : ''
        };
    }
    return {
        ...base, districtType: object.districtType || 'district',
        parentId: object.parentId ? String(object.parentId) : '',
        color: object.style?.color || '#5b8def',
        opacity: object.style?.opacity === undefined ? 0.25 : object.style.opacity,
        weight: object.style?.weight || 2
    };
}

export default function GisInspector({
    object, geometryDraft, categories = [], districts = [], canEdit = false, canReview = false, canAdmin = false,
    busy = false, versions = [], onSave, onAction, onWiki, onClose, onFocus, onToggleVertexEdit,
    vertexEdit = false, onLoadVersion, onRollback, onGeometryReset
}) {
    const objectKey = object ? `${object.type}:${object.id}:${object.revision}` : 'none';
    const [formState, setForm] = useState(() => initialForm(object));
    const [wikiId, setWikiId] = useState(object && object.wikiPageId ? String(object.wikiPageId) : '');
    const [showVersions, setShowVersions] = useState(false);
    const [formKey, setFormKey] = useState(objectKey);

    // 切换对象/版本时同步表单（render 阶段派生，避免「新对象 + 旧表单=null」的一帧崩溃）
    if (formKey !== objectKey) {
        setFormKey(objectKey);
        setForm(initialForm(object));
        setWikiId(object && object.wikiPageId ? String(object.wikiPageId) : '');
    }
    // 兜底：无论处于哪个渲染阶段，form 都可用
    const form = (formKey === objectKey ? formState : initialForm(object)) || {};

    const set = (k, v) => setForm((f) => ({ ...(f || {}), [k]: v }));

    const geoInfo = useMemo(() => {
        const geom = geometryDraft || (object && object.geometry);
        if (!geom) return null;
        if (geom.type === 'Point') return 'Point';
        if (geom.type === 'LineString') return `LineString · ${geom.coordinates.length} 个顶点`;
        if (geom.type === 'Polygon') return `Polygon · ${Math.max(0, (geom.coordinates[0] || []).length - 1)} 个顶点`;
        return geom.type;
    }, [geometryDraft, object]);

    if (!object) {
        return (
            <div className="gis-panel gis-inspector">
                <div className="gis-panel-head">属性面板</div>
                <div className="gis-empty">
                    在地图上点击城区 / 道路 / 标记查看属性；<br />
                    或使用上方「绘制道路 / 绘制城区 / 添加标记」新建。
                </div>
            </div>
        );
    }

    const isMarketPlace = object.type === 'market_place';
    if (isMarketPlace) {
        return (
            <div className="gis-panel gis-inspector">
                <div className="gis-panel-head">
                    集市地点
                    <button className="gis-icon-btn" onClick={onClose} aria-label="关闭">×</button>
                </div>
                <div className="gis-kv"><span>名称</span><b>{object.label || object.name}</b></div>
                <div className="gis-kv"><span>服务器</span><b>{object.serverName || object.serverKey}</b></div>
                <div className="gis-kv"><span>维度</span><b>{object.dimension}</b></div>
                <div className="gis-kv"><span>坐标</span><b>X {object.x} Y {object.y} Z {object.z}</b></div>
                {object.note && <div className="gis-kv"><span>备注</span><b>{object.note}</b></div>}
                <div className="gis-kv"><span>公开</span><b>{object.isPublic ? '是' : '否'}</b></div>
                <a className="btn btn-secondary btn-sm" href={object.link || `/market/store/${object.storeId}`}>打开店铺页</a>
                <div className="gis-hint">集市地点由集市模块维护（GIS 只做展示与空间关联），请到「集市 → 商家 → 位置」编辑。</div>
            </div>
        );
    }

    const readOnly = !canEdit;

    const handleSave = () => {
        const payload = { revision: object.revision, name: form.name, description: form.description, wikiPageId: form.wikiPageId === '' ? null : Number(form.wikiPageId) };
        if (object.type === 'marker') {
            payload.category = form.category;
            payload.point = { x: Number(form.x), y: Number(form.y), z: Number(form.z) };
        } else if (object.type === 'road') {
            payload.width = Number(form.width);
            payload.roadLevel = Number(form.roadLevel);
            payload.isMain = !!form.isMain;
            payload.roadType = form.roadType;
            payload.districtId = form.districtId === '' ? null : Number(form.districtId);
            payload.geometry = geometryDraft || object.geometry;
        } else {
            payload.districtType = form.districtType;
            payload.parentId = form.parentId === '' ? null : Number(form.parentId);
            payload.styleColor = form.color;
            payload.styleOpacity = Number(form.opacity);
            payload.styleWeight = Number(form.weight);
            payload.geometry = geometryDraft || object.geometry;
        }
        onSave(payload);
    };

    return (
        <div className="gis-panel gis-inspector">
            <div className="gis-panel-head">
                <span>
                    {object.type === 'district' ? '城区' : object.type === 'road' ? '道路' : '地点标记'} #{object.id}
                    <span className={STATUS_BADGE[object.status] || 'badge'} style={{ marginLeft: 8 }}>{STATUS_LABEL[object.status] || object.status}</span>
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                    {onFocus && <button className="gis-icon-btn" title="定位" onClick={() => onFocus(object)}>◎</button>}
                    <button className="gis-icon-btn" onClick={onClose} aria-label="关闭">×</button>
                </span>
            </div>

            <div className="gis-kv"><span>版本</span><b>v{object.revision}{object.publishedRevision ? `（已发布 v${object.publishedRevision}）` : '（未发布）'}</b></div>
            <div className="gis-kv"><span>世界 / 维度</span><b>{object.worldId} / {object.dimension}</b></div>
            <div className="gis-kv"><span>几何</span><b>{geoInfo}{geometryDraft ? ' · 已修改' : ''}</b></div>
            {object.metrics && object.type === 'road' && <div className="gis-kv"><span>长度</span><b>{Math.round(object.metrics.length)} 方块</b></div>}
            {object.metrics && object.type === 'district' && <div className="gis-kv"><span>面积</span><b>{Math.round(object.metrics.area)} 方块²</b></div>}

            <div className="gis-form">
                <div className="form-group">
                    <label className="form-label">名称 *</label>
                    <input className="form-input" value={form.name} disabled={readOnly} maxLength={60} onChange={(e) => set('name', e.target.value)} />
                </div>

                {object.type === 'marker' && (
                    <>
                        <div className="form-group">
                            <label className="form-label">分类</label>
                            <select className="form-select" value={form.category} disabled={readOnly} onChange={(e) => set('category', e.target.value)}>
                                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </select>
                        </div>
                        <div className="gis-form-row">
                            <div className="form-group"><label className="form-label">X</label><input className="form-input" type="number" step="0.1" value={form.x} disabled={readOnly} onChange={(e) => set('x', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Y</label><input className="form-input" type="number" step="0.1" value={form.y} disabled={readOnly} onChange={(e) => set('y', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Z</label><input className="form-input" type="number" step="0.1" value={form.z} disabled={readOnly} onChange={(e) => set('z', e.target.value)} /></div>
                        </div>
                    </>
                )}

                {object.type === 'road' && (
                    <>
                        <div className="gis-form-row">
                            <div className="form-group"><label className="form-label">宽度（方块）</label><input className="form-input" type="number" min="1" max="64" value={form.width} disabled={readOnly} onChange={(e) => set('width', e.target.value)} /></div>
                            <div className="form-group">
                                <label className="form-label">道路等级</label>
                                <select className="form-select" value={form.roadLevel} disabled={readOnly} onChange={(e) => set('roadLevel', e.target.value)}>
                                    {ROAD_LEVELS.map((l) => <option key={l} value={l}>{l} 级{l === 1 ? '（最高）' : ''}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="gis-form-row">
                            <div className="form-group">
                                <label className="form-label">类型</label>
                                <select className="form-select" value={form.roadType} disabled={readOnly} onChange={(e) => set('roadType', e.target.value)}>
                                    {ROAD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">所属城区</label>
                                <select className="form-select" value={form.districtId} disabled={readOnly} onChange={(e) => set('districtId', e.target.value)}>
                                    <option value="">（无）</option>
                                    {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <label className="gis-check">
                            <input type="checkbox" checked={!!form.isMain} disabled={readOnly} onChange={(e) => set('isMain', e.target.checked)} />
                            主干道
                        </label>
                    </>
                )}

                {object.type === 'district' && (
                    <>
                        <div className="gis-form-row">
                            <div className="form-group">
                                <label className="form-label">类型</label>
                                <select className="form-select" value={form.districtType} disabled={readOnly} onChange={(e) => set('districtType', e.target.value)}>
                                    {DISTRICT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">父级区域</label>
                                <select className="form-select" value={form.parentId} disabled={readOnly} onChange={(e) => set('parentId', e.target.value)}>
                                    <option value="">（无）</option>
                                    {districts.filter((d) => d.id !== object.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="gis-form-row">
                            <div className="form-group"><label className="form-label">颜色</label><input className="form-input" type="color" value={form.color} disabled={readOnly} onChange={(e) => set('color', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">填充透明度</label><input className="form-input" type="number" step="0.05" min="0" max="1" value={form.opacity} disabled={readOnly} onChange={(e) => set('opacity', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">边框宽度</label><input className="form-input" type="number" min="1" max="12" value={form.weight} disabled={readOnly} onChange={(e) => set('weight', e.target.value)} /></div>
                        </div>
                    </>
                )}

                <div className="form-group">
                    <label className="form-label">描述</label>
                    <textarea className="form-textarea" rows={3} maxLength={2000} value={form.description} disabled={readOnly} onChange={(e) => set('description', e.target.value)} />
                </div>

                <div className="form-group">
                    <label className="form-label">关联 Wiki 页面 ID（可空，只存 ID 不复制正文）</label>
                    <div className="gis-inline">
                        <input className="form-input" type="number" min="1" value={wikiId} disabled={readOnly} onChange={(e) => { setWikiId(e.target.value); set('wikiPageId', e.target.value); }} placeholder="例如 123" />
                        {object.wikiPageId && <a className="btn btn-secondary btn-sm" href={`/wiki/id/${object.wikiPageId}`} target="_blank" rel="noreferrer">打开 Wiki</a>}
                    </div>
                </div>

                {object.type !== 'marker' && canEdit && (
                    <div className="gis-inline">
                        <button className={`btn btn-sm ${vertexEdit ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onToggleVertexEdit && onToggleVertexEdit(!vertexEdit)}>
                            {vertexEdit ? '结束顶点拖动' : '顶点拖动'}
                        </button>
                        {geometryDraft && <button className="btn btn-ghost btn-sm" onClick={onGeometryReset}>撤销几何修改</button>}
                    </div>
                )}
            </div>

            <div className="gis-actions">
                {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleSave}>保存（生成新版本）</button>}
                {canEdit && object.status !== 'REVIEW' && object.status !== 'PUBLISHED' && (
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAction('submit')}>提交审核</button>
                )}
                {canReview && object.status === 'REVIEW' && (
                    <>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAction('publish')}>审核通过并发布</button>
                        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAction('reject')}>驳回</button>
                    </>
                )}
                {canEdit && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onWiki(wikiId === '' ? null : Number(wikiId))}>更新 Wiki 关联</button>}
                {canAdmin && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAction('archive')}>归档删除</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setShowVersions((v) => !v)}>{showVersions ? '收起版本' : `版本历史${versions.length ? `（${versions.length}）` : ''}`}</button>
            </div>

            {showVersions && (
                <div className="gis-versions">
                    {versions.length === 0 && <div className="gis-empty">暂无版本记录（需要 gis.access 权限）</div>}
                    {versions.map((v) => (
                        <div key={v.revision} className="gis-version-row">
                            <span>v{v.revision}</span>
                            <span className="gis-dim">{v.action} · {STATUS_LABEL[v.status] || v.status}</span>
                            <span className="gis-dim">{v.created_at}</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => onLoadVersion && onLoadVersion(v.revision)}>查看</button>
                            {canReview && <button className="btn btn-secondary btn-sm" onClick={() => onRollback && onRollback(v.revision)}>回滚</button>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
