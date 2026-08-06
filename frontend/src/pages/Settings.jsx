import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { api, uploadImage } from '../api';

export default function Settings() {
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const fileRef = useRef(null);

  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname || '');
      setAvatar(user.avatar || '');
      setEmail(user.email || '');
    }
  }, [user]);

  if (!user) return null;

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const url = await uploadImage(file);
      setAvatar(url);
      showToast('头像上传成功', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const saveProfile = async () => {
    setLoading(true);
    try {
      await api.put('/api/auth/profile', { nickname, avatar });
      await updateUser({ ...user, nickname, avatar });
      showToast('资料保存成功', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const sendBindCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('请输入正确的邮箱地址', 'error');
      return;
    }
    setCodeLoading(true);
    try {
      await api.post('/api/auth/send-bind-code', { email });
      showToast('验证码已发送，请查收邮箱', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCodeLoading(false);
    }
  };

  const bindEmail = async () => {
    if (!code) {
      showToast('请输入验证码', 'error');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/auth/verify-email', { email, code });
      const me = await api.get('/api/auth/me');
      await updateUser(me);
      showToast('邮箱绑定成功', 'success');
      setCode('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword || !newPassword) {
      showToast('请填写当前密码和新密码', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('新密码至少6位', 'error');
      return;
    }
    setLoading(true);
    try {
      await api.put('/api/auth/profile', { currentPassword, newPassword });
      showToast('密码修改成功', 'success');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const qqBind = () => {
    window.location.href = '/api/auth/qq/bind';
  };

  const sectionTitle = {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8
  };

  return (
    <div className="fade-in-up" style={{ maxWidth: 680, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>账户设置</h1>

      {/* 基本信息 */}
      <div className="card mb-4" style={{ marginBottom: 20 }}>
        <h3 style={sectionTitle}>
          <svg width="20" height="20" fill="none" stroke="var(--primary)" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          基本信息
        </h3>
        <div className="flex" style={{ gap: 16, alignItems: 'center', marginBottom: 16 }}>
          <img
            src={avatar || '/images/default-avatar.png'}
            alt="头像"
            style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--primary-light)' }}
          />
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
            <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current.click()}>更换头像</button>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">昵称</label>
          <input className="form-input" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="请输入昵称" />
        </div>
        <button className="btn btn-primary" onClick={saveProfile} disabled={loading}>保存资料</button>
      </div>

      {/* 绑定信息 */}
      <div className="card mb-4" style={{ marginBottom: 20 }}>
        <h3 style={sectionTitle}>
          <svg width="20" height="20" fill="none" stroke="var(--primary)" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          绑定信息
        </h3>

        {/* QQ绑定状态 */}
        <div className="flex-between" style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 500 }}>QQ绑定</div>
            <div className="text-secondary" style={{ fontSize: 13 }}>使用QQ登录的账号自动绑定</div>
          </div>
          {user.qq_bound ? (
            <span className="badge badge-success">已绑定</span>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={qqBind}>绑定QQ</button>
          )}
        </div>

        {/* 邮箱绑定 */}
        <div style={{ paddingTop: 16 }}>
          <div className="flex-between mb-3">
            <div>
              <div style={{ fontWeight: 500 }}>邮箱绑定</div>
              <div className="text-secondary" style={{ fontSize: 13 }}>绑定邮箱后可接收通知与找回密码</div>
            </div>
            {user.email_bound ? (
              <span className="badge badge-success">已绑定</span>
            ) : (
              <span className="badge badge-warning">未绑定</span>
            )}
          </div>

          {user.email_bound ? (
            <div className="text-secondary" style={{ fontSize: 14 }}>已绑定邮箱：{user.email}</div>
          ) : (
            <div>
              <div className="flex" style={{ gap: 8 }}>
                <input className="form-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="请输入要绑定的邮箱" style={{ flex: 1 }} />
                <button className="btn btn-secondary" onClick={sendBindCode} disabled={codeLoading} style={{ whiteSpace: 'nowrap' }}>
                  {codeLoading ? '发送中...' : '发送验证码'}
                </button>
              </div>
              <div className="flex mt-2" style={{ gap: 8 }}>
                <input className="form-input" value={code} onChange={e => setCode(e.target.value)} placeholder="输入邮箱验证码" style={{ flex: 1 }} />
                <button className="btn btn-primary" onClick={bindEmail} disabled={loading} style={{ whiteSpace: 'nowrap' }}>确认绑定</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 修改密码 */}
      <div className="card">
        <h3 style={sectionTitle}>
          <svg width="20" height="20" fill="none" stroke="var(--primary)" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          修改密码
        </h3>
        <div className="form-group">
          <label className="form-label">当前密码</label>
          <input type="password" className="form-input" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="请输入当前密码" />
        </div>
        <div className="form-group">
          <label className="form-label">新密码</label>
          <input type="password" className="form-input" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="请输入新密码（至少6位）" />
        </div>
        <button className="btn btn-primary" onClick={changePassword} disabled={loading}>修改密码</button>
      </div>
    </div>
  );
}
