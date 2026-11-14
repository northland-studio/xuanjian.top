/**
 * GIS 页面错误边界：地图/编辑器异常时只降级 GIS 页面，不让整个站点白屏。
 * 记录错误与组件栈，便于定位（开发期在控制台可见）。
 */
import { Component } from 'react';

export default class GisErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null, info: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        this.setState({ info });
        try {
            console.error('[gis] 页面渲染异常:', error, info && info.componentStack);
            if (typeof window !== 'undefined') {
                window.__GIS_LAST_ERROR__ = {
                    message: error && error.message,
                    stack: error && error.stack,
                    componentStack: info && info.componentStack
                };
            }
        } catch (e) { /* ignore */ }
    }

    render() {
        if (this.state.error) {
            return (
                <div className="gis-page">
                    <div className="gis-panel" style={{ margin: '24px auto', maxWidth: 640 }}>
                        <div className="gis-panel-head">GIS 页面加载出错</div>
                        <div className="gis-error">{String(this.state.error.message || this.state.error)}</div>
                        <div className="gis-hint">
                            GIS 页面本身出错不会影响站点其它功能。可尝试刷新页面；若持续失败，请把下面的信息反馈给管理员。
                        </div>
                        <pre className="gis-hint" style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>
                            {(this.state.info && this.state.info.componentStack) || ''}
                        </pre>
                        <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>刷新页面</button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
