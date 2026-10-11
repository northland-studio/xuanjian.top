import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { IconArrowLeft, IconClose, IconWarn, Stars } from '../components/MarketIcons';
import { requireLogin, formatDate } from '../utils';
import '../styles/market.css';

const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'paid', label: '待核销' },
  { key: 'delivered', label: '待履约' },
  { key: 'awaiting_confirm', label: '待确认' },
  { key: 'settled', label: '已完成' },
  { key: 'refunding', label: '退款中' },
  { key: 'disputed', label: '争议中' },
  { key: 'refunded', label: '已退款' },
  { key: 'cancelled', label: '已取消' }
];

const STATUS_BADGE = {
  pending_payment: 'badge-warning',
  paid: 'badge-primary',
  delivered: 'badge-primary',
  awaiting_confirm: 'badge-warning',
  settled: 'badge-success',
  cancelled: 'badge-gray',
  refunding: 'badge-danger',
  refunded: 'badge-danger',
  disputed: 'badge-danger',
  expired: 'badge-gray'
};

/** 通用小弹窗：标题 + 内容 + 底部按钮 */
function Dialog({ title, children, onClose, footer, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: wide ? 520 : 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close mk-modal-close" onClick={onClose} aria-label="关闭" title="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function VerifyCodeBlock({ code, order }) {
  const qrTarget = order?.short_code || order?.order_no;
  return (
    <div className="mk-code-box">
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>核销码</div>
      <div className="mk-code-value">{code || '——'}</div>
      <div className="mk-code-warn"><IconWarn size={15} />只显示这一次，请立即交给商家或截图保存</div>
      {qrTarget ? <img className="mk-code-qr" src={`/api/market/qr/${qrTarget}.png`} alt="核销码二维码" /> : null}
    </div>
  );
}

function OrderCard({ order, statusLabel, onChanged }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);
  const [dialog, setDialog] = useState(null); // 'refund' | 'dispute' | 'review' | 'code'
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');

  const loadDetail = useCallback(async () => {
    try {
      const d = await api.get(`/api/market/orders/${order.id}`);
      setDetail(d);
      return d;
    } catch (e) {
      showToast(e.message || '加载订单详情失败', 'error');
      return null;
    }
  }, [order.id, showToast]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) await loadDetail();
  };

  const doAction = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) showToast(okMsg, 'success');
      await loadDetail();
      onChanged?.();
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const status = detail?.order?.status || order.status;
  const tail = detail?.verify?.tail || order.code_tail;
  const verifyUsed = detail?.verify?.used;
  const amount = Number(order.buyer_pay ?? order.amount ?? 0);

  // 任意未完成状态均可发起争议
  const canDispute = !['settled', 'cancelled', 'refunded', 'expired', 'disputed'].includes(status);
  const canRefund = ['paid', 'delivered', 'awaiting_confirm'].includes(status) || status === 'settled';

  return (
    <div className="mk-order-card">
      <div className="mk-order-head" onClick={toggle}>
        <img
          src={order.store_avatar || '/images/default-avatar.png'}
          alt=""
          onError={e => { e.currentTarget.src = '/images/default-avatar.png'; }}
        />
        <div className="mk-order-title">
          <div className="n">
            <Link to={`/market/store/${order.store_id}`} onClick={e => e.stopPropagation()}>{order.store_name || '店铺'}</Link>
          </div>
          <div className="s">{order.items_title || '订单商品'}</div>
          <div className="s">订单号 {order.order_no} · {formatDate(order.created_at)}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span className={`badge ${STATUS_BADGE[status] || 'badge-gray'}`}>{statusLabel?.[status] || status}</span>
          <div className="mk-price" style={{ fontSize: 14, marginTop: 4 }}>{amount.toFixed(2)}<small> 点</small></div>
        </div>
      </div>

      {open && (
        <div className="mk-order-body">
          {!detail ? (
            <div className="loading"><div className="spinner" />加载中...</div>
          ) : (
            <>
              <div className="mk-list-row">
                <div className="grow">
                  {(detail.items || []).map(it => (
                    <div key={it.id} style={{ marginBottom: 4 }}>
                      <strong>{it.title_snapshot}</strong>（数量 {it.quantity}）
                      <span className="text-secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        {Number(it.unit_price || 0).toFixed(2)} 点 / 件
                      </span>
                      {it.product_id ? (
                        <Link to={`/market/product/${it.product_id}`} style={{ marginLeft: 8, fontSize: 12 }}>查看商品</Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mk-kv">
                <span>商品金额 {Number(detail.order.tax_base ?? detail.order.amount ?? 0).toFixed(2)}</span>
                <span>交易税 {Number(detail.order.tax_amount || 0).toFixed(2)}</span>
                <span>实付 {Number(detail.order.buyer_pay || 0).toFixed(2)}</span>
                <span>商家收入 {Number(detail.order.merchant_income || 0).toFixed(2)}</span>
              </div>

              {detail.verify && !verifyUsed && (
                <div className="mk-note" style={{ marginTop: 6 }}>
                  核销码末四位 <strong>{detail.verify.tail || tail || '----'}</strong>
                  {detail.verify.expires_at ? ` · 有效期至 ${formatDate(detail.verify.expires_at)}` : ''}
                </div>
              )}
              {verifyUsed && <div className="mk-note" style={{ marginTop: 6, color: 'var(--success)' }}>该核销码已在游戏内核销</div>}
              {detail.order.remark && <div className="mk-note" style={{ marginTop: 6 }}>买家备注：{detail.order.remark}</div>}

              {(detail.refunds || []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="mk-note"><strong>退款记录</strong></div>
                  {detail.refunds.map(r => (
                    <div key={r.id} className="mk-note">
                      #{r.id} {Number(r.amount || 0).toFixed(2)} 点 · {r.status === 'pending' ? '待处理' : r.status === 'done' ? '已退款' : '已拒绝'}
                      {r.reason ? `（${r.reason}）` : ''}{r.handle_note ? ` · 处理说明：${r.handle_note}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {detail.dispute && (
                <div className="mk-note" style={{ marginTop: 8, color: 'var(--danger)' }}>
                  争议 #{detail.dispute.id}：{detail.dispute.status === 'open' ? '处理中' : detail.dispute.status}
                  {detail.dispute.reason ? `（${detail.dispute.reason}）` : ''}
                  {detail.dispute.result ? ` · 裁决：${detail.dispute.result}` : ''}
                </div>
              )}

              {detail.review && (
                <div className="mk-note mk-icon-text" style={{ marginTop: 8 }}>
                  我的评价：<Stars value={detail.review.rating} showValue={false} size={13} />
                  <span>{detail.review.content}</span>
                </div>
              )}

              <div className="mk-order-actions">
                {status === 'paid' && (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const d = detail || await loadDetail();
                        setCode(d?.verify?.tail ? `末四位 ${d.verify.tail}（完整核销码只在生成时显示）` : '核销码已失效');
                        setDialog('code');
                      }}
                    >
                      查看核销码信息
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm('完整核销码只在生成时显示。重新生成会作废旧码并返回新码，确定继续？')) return;
                        doAction(async () => {
                          const r = await api.post(`/api/market/orders/${order.id}/regen-code`, {});
                          setCode(r.verify_code);
                          setDialog('code');
                        }, '已重新生成核销码（旧码作废）');
                      }}
                    >
                      重新生成核销码
                    </button>
                  </>
                )}

                {status === 'awaiting_confirm' && (
                  <button
                    className="btn btn-success btn-sm"
                    disabled={busy}
                    onClick={() => doAction(() => api.post(`/api/market/orders/${order.id}/confirm`, {}), '已确认收货，交易款已结算给商家')}
                  >
                    确认收货
                  </button>
                )}

                {status === 'settled' && !detail.review && (
                  <button className="btn btn-primary btn-sm" onClick={() => setDialog('review')}>评价店铺</button>
                )}

                {canRefund && status !== 'refunding' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setDialog('refund')}>
                    {status === 'settled' ? '申请退款（售后）' : '申请退款'}
                  </button>
                )}

                {canDispute && (
                  <button className="btn btn-danger btn-sm" onClick={() => setDialog('dispute')}>发起争议</button>
                )}

                {['paid', 'pending_payment'].includes(status) && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => {
                      const r = prompt('取消原因（可选）');
                      if (r === null) return;
                      doAction(() => api.post(`/api/market/orders/${order.id}/cancel`, { reason: r }), '订单已取消');
                    }}
                  >
                    取消订单
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {dialog === 'code' && (
        <Dialog
          title="核销码"
          onClose={() => setDialog(null)}
          footer={<button className="btn btn-primary" onClick={() => setDialog(null)}>我已记下</button>}
        >
          <VerifyCodeBlock code={code} order={order} />
        </Dialog>
      )}

      {dialog === 'refund' && (
        <Dialog
          title="申请退款"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>取消</button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => doAction(async () => {
                  await api.post(`/api/market/orders/${order.id}/refund`, { reason });
                  setDialog(null);
                  setReason('');
                }, '退款申请已提交，等待商家处理')}
              >
                提交申请
              </button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label">退款原因</label>
            <textarea
              className="form-textarea"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="例如：商家未按时交付 / 商品与描述不符"
            />
          </div>
          <div className="mk-note">提交后订单进入「退款处理中」，需店主或管理员同意才会退款。</div>
        </Dialog>
      )}

      {dialog === 'dispute' && (
        <Dialog
          title="发起争议"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>取消</button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => doAction(async () => {
                  await api.post(`/api/market/orders/${order.id}/dispute`, { reason });
                  setDialog(null);
                  setReason('');
                }, '争议已提交，管理员会介入处理')}
              >
                提交争议
              </button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label">争议说明</label>
            <textarea
              className="form-textarea"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="请描述问题与你的诉求（退款 / 要求履约）"
            />
          </div>
        </Dialog>
      )}

      {dialog === 'review' && (
        <Dialog
          title="评价店铺"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDialog(null)}>取消</button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => doAction(async () => {
                  await api.post('/api/market/reviews', { order_id: order.id, rating, content });
                  setDialog(null);
                  setContent('');
                }, '评价已提交，感谢反馈')}
              >
                提交评价
              </button>
            </>
          }
        >
          <div className="form-group">
            <label className="form-label">评分</label>
            <div className="mk-inline">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`btn btn-sm mk-icon-text ${n <= rating ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setRating(n)}
                  aria-label={`${n} 星`}
                  title={`${n} 星`}
                >
                  <Stars value={n} showValue={false} size={12} className="mk-stars mk-stars-plain" />
                </button>
              ))}
              <span className="mk-stars">{rating} 星</span>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">评价内容</label>
            <textarea
              className="form-textarea"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="说说交易体验、交付速度、商品质量……"
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}

export default function MarketOrders() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusLabel, setStatusLabel] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (p = 1, append = false) => {
    if (!user) { setLoading(false); return; }
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '10', page: String(p) });
      if (status) qs.set('status', status);
      const d = await api.get(`/api/market/orders?${qs.toString()}`);
      setTotal(d.total || 0);
      setPage(p);
      setStatusLabel(d.statusLabel || {});
      setItems(prev => (append ? [...prev, ...(d.items || [])] : (d.items || [])));
    } catch (e) {
      showToast(e.message || '加载订单失败', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [status, user, showToast]);

  useEffect(() => { load(1, false); }, [load]);

  if (!user) {
    return (
      <div className="fade-in-up">
        <div className="section-head">
          <h2 className="section-title">我的订单</h2>
        </div>
        <div className="empty-state">
          <p>登录后查看你的集市订单、核销码与退款申请</p>
          <button className="btn btn-primary" onClick={() => requireLogin(navigate, '请先登录后再查看订单')}>去登录</button>
        </div>
      </div>
    );
  }

  const hasMore = items.length < total;

  return (
    <div className="fade-in-up">
      <div className="section-head">
        <h2 className="section-title">我的订单</h2>
        <p className="section-desc">核销码只显示一次，请及时交给商家；确认收货后交易款才结算给商家</p>
      </div>

      <div className="mk-inline" style={{ marginBottom: 12 }}>
        <Link to="/market" className="btn btn-secondary btn-sm mk-icon-text"><IconArrowLeft size={14} />集市首页</Link>
        <Link to="/market/map" className="btn btn-secondary btn-sm">店铺地图</Link>
      </div>

      <div className="mk-chips" style={{ marginBottom: 14 }}>
        <span className="mk-chips-label">状态</span>
        {STATUS_TABS.map(t => (
          <button key={t.key} className={`mk-chip ${status === t.key ? 'active' : ''}`} onClick={() => setStatus(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />加载中...</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>还没有订单</p>
          <Link to="/market" className="btn btn-primary">去集市逛逛</Link>
        </div>
      ) : (
        <>
          <div className="mk-result-line"><span>共 {total} 笔订单</span></div>
          {items.map(o => (
            <OrderCard
              key={o.id}
              order={o}
              statusLabel={statusLabel}
              onChanged={() => load(1, false)}
            />
          ))}
          {hasMore && (
            <div className="mk-loadmore">
              <button className="btn btn-secondary" onClick={() => load(page + 1, true)} disabled={loadingMore}>
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
