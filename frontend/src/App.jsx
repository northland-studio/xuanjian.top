import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import AnnouncementPopup from './components/AnnouncementPopup';
import UpdateCheck from './components/UpdateCheck';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import ContentList from './pages/ContentList';
import PostDetail from './pages/PostDetail';
import Editor from './pages/Editor';
import Shop from './pages/Shop';
import Rankings from './pages/Rankings';
import Social from './pages/Social';
import Notifications from './pages/Notifications';
import Checkin from './pages/Checkin';
import Claims from './pages/Claims';
import Inventory from './pages/Inventory';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Admin from './pages/Admin';
import Tasks from './pages/Tasks';
import Following from './pages/Following';
import Trade from './pages/Trade';
import Economics from './pages/Economics';
import Mods from './pages/Mods';
import Projections from './pages/Projections';
import Freeze from './pages/Freeze';
import Gdars from './pages/Gdars';
import Gmirs from './pages/Gmirs';

// 主站路由：统一包裹在 Layout（含主站导航/页脚）内
function MainSite() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/:username" element={<Profile />} />
        <Route path="/daily" element={<ContentList type="daily" title="公会日报" />} />
        <Route path="/decision" element={<ContentList type="decision" title="决策公示" />} />
        <Route path="/forum" element={<ContentList type="forum" title="公会贴吧" />} />
        <Route path="/post/:id" element={<PostDetail />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/editor/:id" element={<Editor />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/rankings" element={<Rankings />} />
        <Route path="/social" element={<Social />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/checkin" element={<Checkin />} />
        <Route path="/claims" element={<Claims />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/following" element={<Following />} />
        <Route path="/trade" element={<Trade />} />
        <Route path="/economics" element={<Economics />} />
        <Route path="/mods" element={<Mods />} />
        <Route path="/projections" element={<Projections />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <>
      <AnnouncementPopup />
      <UpdateCheck />
      <Routes>
        {/* 独立前端子路由：不挂载主站导航栏（/gdars /gmirs 后续 CNAME 绑定子域名） */}
        <Route path="/freeze" element={<Freeze />} />
        <Route path="/gdars" element={<Gdars />} />
        <Route path="/gmirs" element={<Gmirs />} />

        {/* 其余主站路由统一走带导航的布局 */}
        <Route path="/*" element={<MainSite />} />
      </Routes>
    </>
  );
}
