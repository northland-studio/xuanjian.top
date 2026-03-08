(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const o of s)if(o.type==="childList")for(const a of o.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function i(s){const o={};return s.integrity&&(o.integrity=s.integrity),s.referrerPolicy&&(o.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?o.credentials="include":s.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function n(s){if(s.ep)return;s.ep=!0;const o=i(s);fetch(s.href,o)}})();const et="modulepreload",it=function(t,e){return new URL(t,e).href},J={},nt=function(e,i,n){let s=Promise.resolve();if(i&&i.length>0){let a=function(g){return Promise.all(g.map(y=>Promise.resolve(y).then(w=>({status:"fulfilled",value:w}),w=>({status:"rejected",reason:w}))))};const p=document.getElementsByTagName("link"),v=document.querySelector("meta[property=csp-nonce]"),h=(v==null?void 0:v.nonce)||(v==null?void 0:v.getAttribute("nonce"));s=a(i.map(g=>{if(g=it(g,n),g in J)return;J[g]=!0;const y=g.endsWith(".css"),w=y?'[rel="stylesheet"]':"";if(!!n)for(let L=p.length-1;L>=0;L--){const P=p[L];if(P.href===g&&(!y||P.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${g}"]${w}`))return;const b=document.createElement("link");if(b.rel=y?"stylesheet":et,y||(b.as="script"),b.crossOrigin="",b.href=g,h&&b.setAttribute("nonce",h),document.head.appendChild(b),y)return new Promise((L,P)=>{b.addEventListener("load",L),b.addEventListener("error",()=>P(new Error(`Unable to preload CSS for ${g}`)))})}))}function o(a){const p=new Event("vite:preloadError",{cancelable:!0});if(p.payload=a,window.dispatchEvent(p),!p.defaultPrevented)throw a}return s.then(a=>{for(const p of a||[])p.status==="rejected"&&o(p.reason);return e().catch(o)})},K="https://xuanjian.top/api",l={token:localStorage.getItem("token"),currentUser:JSON.parse(localStorage.getItem("user")||"null"),currentPage:"home",sidebarOpen:!1,theme:localStorage.getItem("theme")||"light"},V="https://xuanjian.top",r=t=>document.getElementById(t);function u(t){return t?t.startsWith("data:")||t.startsWith("http://")||t.startsWith("https://")?t:t.startsWith("/")?`${V}${t}`:`${V}/${t}`:""}document.addEventListener("DOMContentLoaded",()=>{st(),at(),rt(),l.currentUser&&(ct(),A()),S()});function st(){const t=localStorage.getItem("theme")||"light";document.documentElement.setAttribute("data-theme",t),l.theme=t;const e=r("themeToggle");e==null||e.addEventListener("click",ot);const i=r("notificationBtn");i==null||i.addEventListener("click",()=>O("notifications"))}function ot(){const t=l.theme==="light"?"dark":"light";l.theme=t,document.documentElement.setAttribute("data-theme",t),localStorage.setItem("theme",t)}function at(){const t=r("menuToggle"),e=r("sidebarOverlay");t==null||t.addEventListener("click",()=>C(!0)),e==null||e.addEventListener("click",()=>C(!1)),document.querySelectorAll(".nav-item").forEach(n=>{n.addEventListener("click",s=>{s.preventDefault();const o=n.dataset.page;o&&(O(o),C(!1))})});const i=r("userInfo");i==null||i.addEventListener("click",()=>{l.currentUser?X(l.currentUser.username):m(),C(!1)})}function C(t){const e=r("sidebar"),i=r("sidebarOverlay");t?(e==null||e.classList.add("open"),i==null||i.classList.add("active")):(e==null||e.classList.remove("open"),i==null||i.classList.remove("active")),l.sidebarOpen=t}async function O(t){switch(document.querySelectorAll(".nav-item").forEach(e=>{e.classList.toggle("active",e.getAttribute("data-page")===t)}),l.currentPage=t,t){case"home":await S();break;case"daily":await U("daily");break;case"decision":await U("decision");break;case"forum":await U("forum");break;case"stock":await I();break;case"shop":await q();break;case"rankings":await tt();break;case"checkin":await E();break;case"inventory":await B();break;case"claims":await F();break;case"notifications":await Lt();break}}function rt(){M()}function M(){const t=r("userInfo");if(t)if(l.currentUser){const e=u(l.currentUser.avatar);t.innerHTML=`
            <div class="user-avatar-placeholder">
                ${e?`<img src="${e}" alt="" onerror="this.parentElement.innerHTML='<svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><path d=\\'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\\'></path><circle cx=\\'12\\' cy=\\'7\\' r=\\'4\\'></circle></svg>'">`:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'}
            </div>
            <div class="user-details">
                <div class="user-name">${l.currentUser.nickname}</div>
                <div class="user-handle">@${l.currentUser.username}</div>
            </div>
        `}else t.innerHTML=`
            <div class="user-avatar-placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </div>
            <div class="user-details">
                <div class="user-name">未登录</div>
                <div class="user-handle">点击登录</div>
            </div>
        `}async function ct(){if(l.token)try{const t=await d("/auth/me");l.currentUser=t,localStorage.setItem("user",JSON.stringify(t)),M()}catch(t){console.error("刷新用户信息失败:",t)}}async function d(t,e){const i=`${K}${t}`,n={"Content-Type":"application/json",...e==null?void 0:e.headers};l.token&&(n.Authorization=`Bearer ${l.token}`);const s=await fetch(i,{...e,headers:n});if(!s.ok){const o=await s.json().catch(()=>({error:"请求失败"}));throw new Error(o.error||"请求失败")}return s.json()}function c(t,e="success"){const i=r("toast-container");if(!i)return;const n=document.createElement("div");n.className=`toast ${e}`,n.textContent=t,i.appendChild(n),setTimeout(()=>n.remove(),3e3)}function T(t){if(!t)return"未知";const e=new Date(t);if(isNaN(e.getTime()))return"未知";const n=new Date().getTime()-e.getTime(),s=Math.floor(n/6e4),o=Math.floor(n/36e5),a=Math.floor(n/864e5);return s<1?"刚刚":s<60?`${s}分钟前`:o<24?`${o}小时前`:a<7?`${a}天前`:e.toLocaleDateString("zh-CN")}async function A(){if(l.token)try{const t=await d("/notifications?limit=1"),e=r("sidebar-notification-badge");e&&(t.unreadCount>0?(e.textContent=t.unreadCount>99?"99+":t.unreadCount.toString(),e.style.display="inline"):e.style.display="none")}catch{}}async function S(){const t=r("content-body");t&&(t.innerHTML=`
        <div class="home-header">
            <h1>欢迎来到玄剑公会</h1>
            <p>我的世界玄剑公会官方社区</p>
            ${l.currentUser?`<button class="btn btn-primary" onclick="showEditorPage()" style="margin-top: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M12 4v16m8-8H4"></path>
                </svg>
                发布内容
            </button>`:""}
        </div>
        
        <h2 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            最新日报
        </h2>
        <div id="home-daily-list"><div class="loading-spinner"><div class="spinner"></div></div></div>
        
        <h2 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="m9 12 2 2 4-4"></path>
            </svg>
            最新决策
        </h2>
        <div id="home-decision-list"><div class="loading-spinner"><div class="spinner"></div></div></div>
    `,lt(),dt())}async function lt(){try{const t=await d("/posts?type=daily&limit=3"),e=r("home-daily-list");if(!e)return;if(t.posts.length===0){e.innerHTML='<div class="empty-state"><p>暂无日报</p></div>';return}e.innerHTML=t.posts.map(i=>z(i)).join(""),_()}catch{const e=r("home-daily-list");e&&(e.innerHTML='<div class="empty-state"><p>加载失败</p></div>')}}async function dt(){try{const t=await d("/posts?type=decision&limit=3"),e=r("home-decision-list");if(!e)return;if(t.posts.length===0){e.innerHTML='<div class="empty-state"><p>暂无决策</p></div>';return}e.innerHTML=t.posts.map(i=>z(i)).join(""),_()}catch{const e=r("home-decision-list");e&&(e.innerHTML='<div class="empty-state"><p>加载失败</p></div>')}}async function U(t){const e=r("content-body");if(e){e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const i=await d(`/posts?type=${t}&limit=50`);if(i.posts.length===0){e.innerHTML='<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><h3>暂无内容</h3></div>';return}e.innerHTML=i.posts.map(n=>z(n)).join(""),_()}catch{e.innerHTML='<div class="empty-state"><h3>加载失败</h3></div>'}}}function z(t){const e=l.currentUser&&l.currentUser.id===t.author_id;return`
        <div class="post-item" data-id="${t.id}">
            <div class="post-header">
                <img src="${u(t.author_avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <div class="post-author">
                    <div class="post-author-name">${t.author_nickname||"未知用户"}</div>
                    <div class="post-time">${T(t.created_at)}</div>
                </div>
                ${t.is_pinned?'<span class="tag">置顶</span>':""}
                ${e?`<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); editPost(${t.id})">编辑</button>`:""}
            </div>
            <div class="post-title">${x(t.title)}</div>
            <div class="post-content">${_t(t.content).substring(0,150)}${t.content.length>150?"...":""}</div>
            <div class="post-footer">
                <span class="post-stat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    ${t.views}
                </span>
                <span class="post-stat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="${t.isLiked?"currentColor":"none"}" stroke="currentColor" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                    ${t.likes}
                </span>
            </div>
        </div>
    `}function _(){document.querySelectorAll(".post-item").forEach(t=>{t.addEventListener("click",()=>{const e=t.dataset.id;e&&j(parseInt(e))})})}async function j(t){const e=r("content-body");if(e){e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const i=await d(`/posts/${t}`),n=i.post,s=l.currentUser&&l.currentUser.id===n.author_id;e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card">
                <div class="post-header">
                    <img src="${u(n.author_avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                    <div class="post-author">
                        <div class="post-author-name">${n.author_nickname||"未知用户"}</div>
                        <div class="post-time">${T(n.created_at)}</div>
                    </div>
                    ${s?`<button class="btn btn-sm btn-secondary" onclick="editPost(${t})">编辑</button>`:""}
                </div>
                <h2 style="font-size: 18px; margin-bottom: 12px;">${x(n.title)}</h2>
                <div class="post-content-full">${n.content||""}</div>
                ${n.images&&n.images.length>0?`
                    <div class="post-images" style="margin-top: 16px;">
                        ${n.images.map(o=>`<img src="${u(o)}" onclick="previewImage('${u(o)}')" style="cursor: pointer;">`).join("")}
                    </div>
                `:""}
                <div class="post-footer" style="margin-top: 16px;">
                    <span class="post-stat">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        ${n.views}
                    </span>
                    <span class="post-stat" onclick="toggleLike(${t})" style="cursor: pointer;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="${n.isLiked?"currentColor":"none"}" stroke="currentColor" stroke-width="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                        ${n.likes}
                    </span>
                </div>
            </div>
            
            <div class="card" style="margin-top: 16px;">
                <h3 class="card-title">发表评论</h3>
                <div id="reply-info" style="display: none; margin-bottom: 8px; padding: 8px; background: var(--bg-tertiary); border-radius: 8px;">
                    <span id="reply-to-name"></span>
                    <button class="btn btn-sm btn-secondary" onclick="cancelReply()" style="margin-left: 8px;">取消</button>
                </div>
                <textarea id="comment-input" placeholder="写下你的评论..." style="width: 100%; min-height: 80px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); resize: vertical;"></textarea>
                <button class="btn btn-primary" onclick="submitComment(${t})" style="margin-top: 8px;">发表评论</button>
            </div>
            
            <h3 class="section-title" style="margin-top: 20px;">评论 (${i.comments.length})</h3>
            <div id="comments-list">
                ${i.comments.length===0?'<div class="empty-state"><p>暂无评论，快来抢沙发吧！</p></div>':i.comments.map(o=>G(o)).join("")}
            </div>
        `}catch{e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}function G(t){var n;const e=((n=t.replies)==null?void 0:n.map(s=>G(s)).join(""))||"",i=t.reply_to?`<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">回复 @${t.reply_to.nickname}</div>`:"";return`
        <div class="card">
            <div class="post-header">
                <img src="${u(t.author_avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <div class="post-author">
                    <div class="post-author-name">${t.author_nickname}</div>
                    <div class="post-time">${T(t.created_at)}</div>
                </div>
            </div>
            ${i}
            <div style="color: var(--text-secondary);">${x(t.content)}</div>
            <div style="margin-top: 8px;">
                <button class="btn btn-sm btn-secondary" onclick="setReplyTo(${t.id}, '${x(t.author_nickname||"")}')">回复</button>
            </div>
            ${e?`<div style="margin-top: 12px; padding-left: 12px; border-left: 2px solid var(--border);">${e}</div>`:""}
        </div>
    `}let R=null;function pt(t,e){R=t;const i=r("reply-info"),n=r("reply-to-name");i&&n&&(n.textContent=`回复 @${e}`,i.style.display="block");const s=r("comment-input");s&&s.focus()}function vt(){R=null;const t=r("reply-info");t&&(t.style.display="none")}async function ut(t){if(!l.currentUser){m();return}const e=r("comment-input"),i=e==null?void 0:e.value.trim();if(!i){c("请输入评论内容","error");return}try{await d(`/posts/${t}/comments`,{method:"POST",body:JSON.stringify({content:i,parentId:R})}),c("评论成功"),j(t)}catch(n){c(n.message||"评论失败","error")}}function Q(){O(l.currentPage)}async function gt(t){if(!l.currentUser){m();return}try{await d(`/posts/${t}/like`,{method:"POST"}),j(t)}catch{c("操作失败","error")}}async function X(t){var i;const e=r("content-body");if(e){e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const s=(await d(`/auth/user/${t}`)).user,o=((i=l.currentUser)==null?void 0:i.username)===t;e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card" style="text-align: center;">
                <img src="${u(s.avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" style="width: 80px; height: 80px; border-radius: 50%; margin-bottom: 16px;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <h2 style="margin-bottom: 8px;">${s.nickname}</h2>
                <p style="color: var(--text-muted); margin-bottom: 8px;">@${s.username}</p>
                <span class="tag">${s.level>=2?"超级管理员":s.level>=1?"管理员":"普通成员"}</span>
            </div>
            
            <div class="card">
                <h3 class="card-title">账号信息</h3>
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <span style="color: var(--text-secondary);">邮箱</span>
                    <span>${s.email||"未设置"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <span style="color: var(--text-secondary);">邮箱验证</span>
                    <span style="color: ${s.is_email_verified?"var(--success)":"var(--warning)"};">${s.is_email_verified?"已验证":"未验证"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0;">
                    <span style="color: var(--text-secondary);">注册时间</span>
                    <span>${T(s.created_at)}</span>
                </div>
            </div>
            
            ${o?`
                <button class="btn btn-secondary btn-block" onclick="showSettingsPage()" style="margin-top: 12px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    账号设置
                </button>
                
                ${s.level>=1?`
                    <button class="btn btn-primary btn-block" onclick="showAdminPage()" style="margin-top: 12px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                        管理系统
                    </button>
                `:""}
                
                <button class="btn btn-danger btn-block" onclick="handleLogout()" style="margin-top: 12px;">退出登录</button>
            `:""}
            
            <h3 class="section-title" style="margin-top: 20px;">发布的帖子</h3>
            <div id="profile-posts-list"><div class="loading-spinner"><div class="spinner"></div></div></div>
        `;try{const a=await d(`/posts?author=${t}&limit=20`),p=r("profile-posts-list");p&&(a.posts.length>0?(p.innerHTML=a.posts.map(v=>z(v)).join(""),_()):p.innerHTML='<div class="empty-state"><p>暂无帖子</p></div>')}catch{const a=r("profile-posts-list");a&&(a.innerHTML='<div class="empty-state"><p>加载失败</p></div>')}}catch{e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>用户不存在</h3></div>
        `}}}function yt(){const t=r("content-body");if(!t||!l.currentUser)return;const e=l.currentUser;t.innerHTML=`
        <button class="btn btn-secondary" onclick="showProfile('${e.username}')" style="margin-bottom: 16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M19 12H5M12 19l-7-7 7-7"></path>
            </svg>
            返回
        </button>
        
        <div class="card">
            <h3 class="card-title">修改头像</h3>
            <div style="text-align: center; margin-bottom: 16px;">
                <img id="settings-avatar-preview" src="${u(e.avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 12px;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <br>
                <button class="btn btn-secondary" onclick="selectAvatar()">选择图片</button>
            </div>
        </div>
        
        <div class="card">
            <h3 class="card-title">修改资料</h3>
            <div class="form-group">
                <label>昵称</label>
                <input type="text" id="settings-nickname" value="${e.nickname||""}" placeholder="请输入昵称">
            </div>
            <div class="form-group">
                <label>邮箱 ${e.is_email_verified?'<span style="color: var(--success);">✓ 已验证</span>':'<span style="color: var(--warning);">⚠ 未验证</span>'}</label>
                <input type="email" id="settings-email" value="${e.email||""}" placeholder="请输入邮箱" ${e.is_email_verified?"disabled":""}>
            </div>
            <button class="btn btn-primary btn-block" onclick="saveProfile()">保存资料</button>
        </div>
        
        <div class="card">
            <h3 class="card-title">修改密码</h3>
            <div class="form-group">
                <label>当前密码</label>
                <input type="password" id="settings-old-password" placeholder="请输入当前密码">
            </div>
            <div class="form-group">
                <label>新密码</label>
                <input type="password" id="settings-new-password" placeholder="请输入新密码">
            </div>
            <div class="form-group">
                <label>确认新密码</label>
                <input type="password" id="settings-confirm-password" placeholder="请再次输入新密码">
            </div>
            <button class="btn btn-primary btn-block" onclick="changePassword()">修改密码</button>
        </div>
    `}async function mt(){const t=await N();if(t){const e=r("settings-avatar-preview");e&&(e.src=t),c("头像已上传，请保存资料")}}async function ht(){var n,s,o;const t=(n=r("settings-nickname"))==null?void 0:n.value.trim(),e=(s=r("settings-email"))==null?void 0:s.value.trim(),i=(o=r("settings-avatar-preview"))==null?void 0:o.src;if(!t){c("请输入昵称","error");return}try{const a={nickname:t,email:e};i&&!i.includes("default-avatar")&&(a.avatar=i);const p=await d("/auth/profile",{method:"PUT",body:JSON.stringify(a)});p.user&&(l.currentUser=p.user,localStorage.setItem("user",JSON.stringify(p.user))),M(),c("保存成功")}catch(a){c(a.message||"保存失败","error")}}async function bt(){var n,s,o;const t=(n=r("settings-old-password"))==null?void 0:n.value,e=(s=r("settings-new-password"))==null?void 0:s.value,i=(o=r("settings-confirm-password"))==null?void 0:o.value;if(!t||!e||!i){c("请填写完整信息","error");return}if(e!==i){c("两次密码不一致","error");return}if(e.length<6){c("密码至少6位","error");return}try{await d("/auth/password",{method:"PUT",body:JSON.stringify({oldPassword:t,newPassword:e})}),c("密码修改成功"),r("settings-old-password").value="",r("settings-new-password").value="",r("settings-confirm-password").value=""}catch(a){c(a.message||"修改失败","error")}}let k=null,f=[];function H(t){if(!r("content-body"))return;if(!l.currentUser){m();return}k=t||null,f=[];let i={title:"",content:"",type:"forum",images:[]};t?d(`/posts/${t}`).then(n=>{i={title:n.post.title,content:n.post.content,type:n.post.type,images:n.post.images||[]},f=i.images,W(i)}).catch(()=>{c("加载帖子失败","error")}):W(i)}function W(t){const e=r("content-body");if(!e)return;const i=l.currentUser&&l.currentUser.level>=1;e.innerHTML=`
        <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M19 12H5M12 19l-7-7 7-7"></path>
            </svg>
            返回
        </button>
        
        <div class="card">
            <h3 class="card-title">${k?"编辑帖子":"发布新帖"}</h3>
            
            <div class="form-group">
                <label>标题</label>
                <input type="text" id="editor-title" value="${x(t.title)}" placeholder="请输入标题">
            </div>
            
            <div class="form-group">
                <label>类型</label>
                <select id="editor-type" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary);">
                    <option value="forum" ${t.type==="forum"?"selected":""}>贴吧</option>
                    ${i?`
                        <option value="daily" ${t.type==="daily"?"selected":""}>日报</option>
                        <option value="decision" ${t.type==="decision"?"selected":""}>决策</option>
                    `:""}
                </select>
            </div>
            
            <div class="form-group">
                <label>内容</label>
                <div class="editor-toolbar" style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-sm btn-secondary" onclick="editorAction('bold')"><strong>B</strong></button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="editorAction('italic')"><em>I</em></button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="editorAction('underline')"><u>U</u></button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="addEditorImage()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        图片
                    </button>
                </div>
                <textarea id="editor-content" placeholder="请输入内容..." style="width: 100%; min-height: 200px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); resize: vertical; line-height: 1.6;">${x(t.content)}</textarea>
            </div>
            
            <div id="editor-images" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
                ${f.map((n,s)=>`
                    <div style="position: relative; width: 80px; height: 80px;">
                        <img src="${u(n)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">
                        <button onclick="removeEditorImage(${s})" style="position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; border-radius: 50%; background: var(--danger); color: white; border: none; font-size: 14px;">x</button>
                    </div>
                `).join("")}
            </div>
            
            <button class="btn btn-primary btn-block" onclick="submitPost()">
                ${k?"保存修改":"发布"}
            </button>
        </div>
    `}function ft(t){const e=r("editor-content");if(!e)return;const i=e.selectionStart,n=e.selectionEnd,s=e.value.substring(i,n),o={bold:["<strong>","</strong>"],italic:["<em>","</em>"],underline:["<u>","</u>"]},[a,p]=o[t]||["",""];e.value=e.value.substring(0,i)+a+s+p+e.value.substring(n),e.focus(),e.selectionStart=i+a.length,e.selectionEnd=i+a.length+s.length}async function xt(){const t=await N();if(t){f.push(t);const e=r("editor-images");if(e){const i=document.createElement("div");i.style.cssText="position: relative; width: 80px; height: 80px;",i.innerHTML=`
                <img src="${u(t)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">
                <button onclick="removeEditorImage(${f.length-1})" style="position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; border-radius: 50%; background: var(--danger); color: white; border: none; font-size: 14px;">x</button>
            `,e.appendChild(i)}}}function wt(t){f.splice(t,1),k?H(k):H()}async function kt(){var n,s,o;const t=(n=r("editor-title"))==null?void 0:n.value.trim(),e=(s=r("editor-type"))==null?void 0:s.value,i=(o=r("editor-content"))==null?void 0:o.value.trim();if(!t||!i){c("请填写标题和内容","error");return}try{k?(await d(`/posts/${k}`,{method:"PUT",body:JSON.stringify({title:t,content:i,images:f})}),c("修改成功")):(await d("/posts",{method:"POST",body:JSON.stringify({title:t,content:i,type:e,images:f})}),c("发布成功")),Q()}catch(a){c(a.message||"操作失败","error")}}function $t(t){H(t)}async function Tt(){var e,i;const t=r("content-body");if(!(!t||!l.currentUser||l.currentUser.level<1)){t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const n=await d("/admin/stats");t.innerHTML=`
            <button class="btn btn-secondary" onclick="showProfile('${(e=l.currentUser)==null?void 0:e.username}')" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card">
                <h3 class="card-title">系统统计</h3>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${n.totalUsers}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">用户数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${n.totalPosts}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">帖子数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${n.totalComments}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">评论数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${n.totalViews}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">总浏览</div>
                    </div>
                </div>
            </div>
            
            <button class="btn btn-primary btn-block" onclick="showEditorPage()" style="margin-top: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M12 4v16m8-8H4"></path>
                </svg>
                发布新帖
            </button>
        `}catch{t.innerHTML=`
            <button class="btn btn-secondary" onclick="showProfile('${(i=l.currentUser)==null?void 0:i.username}')" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}async function Lt(){const t=r("content-body");if(t){if(!l.currentUser){m();return}t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const e=await d("/notifications");if(e.notifications.length===0){t.innerHTML=`
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <h3>暂无通知</h3>
                </div>
            `;return}t.innerHTML=e.notifications.map(i=>Mt(i)).join(""),document.querySelectorAll(".notification-item").forEach(i=>{i.addEventListener("click",async()=>{const n=i.dataset.id,s=i.dataset.postId;n&&(await d(`/notifications/${n}/read`,{method:"PUT"}),A()),s&&j(parseInt(s))})})}catch{t.innerHTML='<div class="empty-state"><h3>加载失败</h3></div>'}}}function Mt(t){const e={post_daily:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',post_decision:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>',comment:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',like:'<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>'},i={post_daily:"daily",post_decision:"decision",comment:"comment",like:"like"};return`
        <div class="notification-item ${t.is_read?"":"unread"}" data-id="${t.id}" data-post-id="${t.post_id||""}">
            <div class="notification-icon ${i[t.type]||"daily"}">
                ${e[t.type]||""}
            </div>
            <div class="notification-content">
                <div class="notification-title">${x(t.title)}</div>
                <div class="notification-text">${x(t.content||t.post_title||"")}</div>
                <div class="notification-meta">${T(t.created_at)}${t.actor_nickname?` · 来自 ${t.actor_nickname}`:""}</div>
            </div>
        </div>
    `}function m(){const t=r("login-modal");t==null||t.classList.add("active")}function D(){const t=r("login-modal");t==null||t.classList.remove("active")}function Pt(){D();const t=r("register-modal");t==null||t.classList.add("active")}function Y(){const t=r("register-modal");t==null||t.classList.remove("active")}async function Ct(){var i,n;const t=(i=r("login-username"))==null?void 0:i.value.trim(),e=(n=r("login-password"))==null?void 0:n.value;if(!t||!e){c("请填写用户名和密码","error");return}try{const s=await d("/auth/login",{method:"POST",body:JSON.stringify({username:t,password:e})});l.token=s.token,l.currentUser=s.user,localStorage.setItem("token",s.token),localStorage.setItem("user",JSON.stringify(s.user)),D(),M(),A(),c("登录成功"),S()}catch(s){c(s.message||"登录失败","error")}}let $=0;async function Ht(){var e;const t=(e=r("register-email"))==null?void 0:e.value.trim();if(!t){c("请输入邮箱","error");return}if($>0){c(`请等待 ${$} 秒`,"error");return}try{await d("/auth/send-code",{method:"POST",body:JSON.stringify({email:t})}),c("验证码已发送"),$=60;const i=r("send-code-btn");if(i){const n=setInterval(()=>{$--,$>0?i.textContent=`${$}s`:(i.textContent="发送验证码",clearInterval(n))},1e3)}}catch(i){c(i.message||"发送失败","error")}}async function St(){var o,a,p,v,h;const t=(o=r("register-username"))==null?void 0:o.value.trim(),e=(a=r("register-nickname"))==null?void 0:a.value.trim(),i=(p=r("register-email"))==null?void 0:p.value.trim(),n=(v=r("register-password"))==null?void 0:v.value,s=(h=r("register-code"))==null?void 0:h.value.trim();if(!t||!e||!i||!n||!s){c("请填写完整信息","error");return}try{await d("/auth/register",{method:"POST",body:JSON.stringify({username:t,nickname:e,email:i,password:n,code:s})}),c("注册成功，请登录"),Y(),m()}catch(g){c(g.message||"注册失败","error")}}function zt(){l.token=null,l.currentUser=null,localStorage.removeItem("token"),localStorage.removeItem("user"),M(),c("已退出登录"),S()}function x(t){if(!t)return"";const e=document.createElement("div");return e.textContent=t,e.innerHTML}function _t(t){if(!t)return"";const e=document.createElement("div");return e.innerHTML=t,e.textContent||e.innerText||""}window.previewImage=t=>{var i;let e=document.querySelector(".image-preview-modal");e?(i=e.querySelector("img"))==null||i.setAttribute("src",t):(e=document.createElement("div"),e.className="image-preview-modal",e.innerHTML=`
            <button class="image-preview-close" onclick="closeImagePreview()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <img src="${t}">
        `,e.addEventListener("click",n=>{n.target===e&&e.classList.remove("active")}),document.body.appendChild(e)),e.classList.add("active")};window.closeImagePreview=()=>{const t=document.querySelector(".image-preview-modal");t&&t.classList.remove("active")};window.showLoginModal=m;window.hideLoginModal=D;window.showRegisterModal=Pt;window.hideRegisterModal=Y;window.handleLogin=Ct;window.handleRegister=St;window.handleLogout=zt;window.sendVerificationCode=Ht;window.toggleLike=gt;window.showSettingsPage=yt;window.showEditorPage=H;window.showAdminPage=Tt;window.showProfile=X;window.goBack=Q;window.setReplyTo=pt;window.cancelReply=vt;window.submitComment=ut;window.editPost=$t;window.editorAction=ft;window.addEditorImage=xt;window.removeEditorImage=wt;window.submitPost=kt;async function N(){try{const{Camera:t,CameraResultType:e}=await nt(async()=>{const{Camera:y,CameraResultType:w}=await import("./index-BYDggx_w.js");return{Camera:y,CameraResultType:w}},[],import.meta.url),i=await t.getPhoto({quality:90,allowEditing:!1,resultType:e.Base64}),n=atob(i.base64String),s=new Array(n.length);for(let y=0;y<n.length;y++)s[y]=n.charCodeAt(y);const o=new Uint8Array(s),a=new Blob([o],{type:"image/jpeg"}),p=new File([a],`photo_${Date.now()}.jpg`,{type:"image/jpeg"}),v=new FormData;v.append("image",p);const h=await fetch(`${K}/upload/image`,{method:"POST",headers:{Authorization:`Bearer ${l.token}`},body:v});if(!h.ok)throw new Error("上传失败");return(await h.json()).url}catch(t){return console.error("图片上传失败:",t),c("图片上传失败","error"),null}}window.selectAndUploadImage=N;window.selectAvatar=mt;window.saveProfile=ht;window.changePassword=bt;async function I(){const t=r("content-body");if(t){t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const[e,i]=await Promise.all([d("/stock/stocks"),d("/stock/portfolio")]),n=e.stocks||[],s=i;t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            
            <div class="card" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white;">
                <div style="font-size: 14px; opacity: 0.8;">总资产</div>
                <div style="font-size: 28px; font-weight: bold; margin: 8px 0;">${(s.totalValue||0).toFixed(2)}</div>
                <div style="display: flex; gap: 24px; margin-top: 16px;">
                    <div>
                        <div style="font-size: 18px; font-weight: 600;">${(s.availablePoints||0).toFixed(2)}</div>
                        <div style="font-size: 12px; opacity: 0.8;">可用贡献点</div>
                    </div>
                    <div>
                        <div style="font-size: 18px; font-weight: 600; color: ${(s.totalProfit||0)>=0?"#86efac":"#fca5a5"};">${(s.totalProfit||0)>=0?"+":""}${(s.totalProfit||0).toFixed(2)}</div>
                        <div style="font-size: 12px; opacity: 0.8;">浮动盈亏</div>
                    </div>
                </div>
            </div>
            
            <h3 class="section-title" style="margin-top: 20px;">股票市场</h3>
            ${n.map(o=>{const a=o.current_price-o.base_price,p=(a/o.base_price*100).toFixed(2),v=a>=0;return`
                    <div class="card" onclick="showStockDetail(${o.id})" style="cursor: pointer;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: 600;">${o.symbol}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">${o.name}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 20px; font-weight: 700;">${o.current_price.toFixed(2)}</div>
                                <div style="font-size: 12px; color: ${v?"var(--success)":"var(--danger)"};">
                                    ${v?"+":""}${a.toFixed(2)} (${v?"+":""}${p}%)
                                </div>
                            </div>
                        </div>
                    </div>
                `}).join("")}
            
            <h3 class="section-title" style="margin-top: 20px;">我的持仓</h3>
            ${(s.holdings||[]).length===0?'<div class="empty-state"><p>暂无持仓</p></div>':s.holdings.map(o=>`
                    <div class="card">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: 600;">${o.symbol}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">${o.name} · ${o.shares}股</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 18px; font-weight: 700;">${(o.current_value||0).toFixed(2)}</div>
                                <div style="font-size: 12px; color: ${(o.profit_loss||0)>=0?"var(--success)":"var(--danger)"};">
                                    ${(o.profit_loss||0)>=0?"+":""}${(o.profit_loss||0).toFixed(2)}
                                </div>
                            </div>
                        </div>
                    </div>
                `).join("")}
        `}catch{t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}let Z=null;async function jt(t){const e=r("content-body");if(e){Z=t,e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const n=(await d(`/stock/stocks/${t}`)).stock,s=n.current_price-n.base_price,o=(s/n.base_price*100).toFixed(2);e.innerHTML=`
            <button class="btn btn-secondary" onclick="showStockPage()" style="margin-bottom: 16px;">返回</button>
            
            <div class="card">
                <h2 style="margin-bottom: 8px;">${n.symbol} - ${n.name}</h2>
                <div style="font-size: 32px; font-weight: 700; margin: 16px 0;">${n.current_price.toFixed(2)}</div>
                <div style="font-size: 14px; color: ${s>=0?"var(--success)":"var(--danger)"};">
                    ${s>=0?"+":""}${s.toFixed(2)} (${s>=0?"+":""}${o}%)
                </div>
            </div>
            
            <div class="card">
                <h3 class="card-title">交易</h3>
                <div class="form-group">
                    <label>数量</label>
                    <input type="number" id="stock-shares" value="1" min="1" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div style="display: flex; gap: 12px;">
                    <button class="btn btn-success" style="flex: 1;" onclick="executeStockTrade('buy')">买入</button>
                    <button class="btn btn-danger" style="flex: 1;" onclick="executeStockTrade('sell')">卖出</button>
                </div>
            </div>
        `}catch{c("加载失败","error"),I()}}}async function It(t){var i;const e=parseInt(((i=r("stock-shares"))==null?void 0:i.value)||"0");if(!e||e<=0){c("请输入有效数量","error");return}try{await d(`/stock/stocks/${Z}/${t}`,{method:"POST",body:JSON.stringify({shares:e})}),c(t==="buy"?"买入成功":"卖出成功"),I()}catch(n){c(n.message||"交易失败","error")}}async function E(){const t=r("content-body");if(t){t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const e=await d("/checkin/status");t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            
            <div class="card" style="background: ${e.todayCheckedIn?"linear-gradient(135deg, #10b981 0%, #059669 100%)":"linear-gradient(135deg, #f59e0b 0%, #f97316 100%)"}; color: white; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 16px;">${e.todayCheckedIn?"✅":"📅"}</div>
                <div style="font-size: 20px; font-weight: 600;">${e.todayCheckedIn?"今日已签到":"今日未签到"}</div>
                <div style="font-size: 14px; opacity: 0.9; margin-top: 8px;">
                    ${e.todayCheckedIn?`已连续签到 ${e.continuousDays} 天`:`签到可获得 ${e.todayReward} 贡献点`}
                </div>
                ${e.todayCheckedIn?"":'<button class="btn" style="margin-top: 16px; background: white; color: #f59e0b;" onclick="doCheckin()">立即签到</button>'}
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 16px;">
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${e.continuousDays}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">连续签到</div>
                </div>
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${e.totalCheckins}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">累计签到</div>
                </div>
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${e.makeupCards}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">补签卡</div>
                </div>
                <div class="card" style="text-align: center;">
                    <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${e.totalContribution}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">贡献点</div>
                </div>
            </div>
            
            <div class="card" style="margin-top: 16px;">
                <h3 class="card-title">补签功能</h3>
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
                    可补签最近7天内未签到的日期，每次消耗1张补签卡
                </p>
                <button class="btn btn-warning btn-block" onclick="buyMakeupCard()">购买补签卡 (50贡献点)</button>
            </div>
            
            <div class="card" style="margin-top: 16px;">
                <h3 class="card-title">连续签到奖励</h3>
                ${(e.rewards||[]).slice(0,7).map(i=>`
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
                        <span>连续 ${i.continuous_days} 天</span>
                        <span style="color: #f59e0b; font-weight: 600;">+${i.reward_points}</span>
                    </div>
                `).join("")}
            </div>
        `}catch{t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}async function Et(){try{const t=await d("/checkin/checkin",{method:"POST"});c(`签到成功！获得 ${t.rewardPoints} 贡献点`),E()}catch(t){c(t.message||"签到失败","error")}}async function Bt(){try{await d("/checkin/buy-makeup-card",{method:"POST",body:JSON.stringify({quantity:1})}),c("购买成功"),E()}catch(t){c(t.message||"购买失败","error")}}window.showStockPage=I;window.showStockDetail=jt;window.executeStockTrade=It;window.showCheckinPage=E;window.doCheckin=Et;window.buyMakeupCard=Bt;window.showShopPage=q;window.showRankingsPage=tt;window.showInventoryPage=B;window.showClaimsPage=F;window.buyTitle=Rt;window.buyItem=qt;window.equipTitle=Dt;window.submitClaim=Nt;async function q(){const t=r("content-body");if(t){t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const[e,i]=await Promise.all([d("/titles"),d("/shop/items")]),n=(e.titles||[]).filter(o=>o.in_shop==1),s=i.items||[];t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            
            <div style="display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto; padding-bottom: 8px;">
                <button class="btn btn-sm btn-primary" onclick="loadShopCategory('all', this)">全部</button>
                <button class="btn btn-sm btn-secondary" onclick="loadShopCategory('title', this)">称号</button>
                <button class="btn btn-sm btn-secondary" onclick="loadShopCategory('item', this)">道具</button>
            </div>
            
            <div id="shop-content">
                <h3 class="section-title">称号商店</h3>
                ${n.length===0?'<p style="color: var(--text-muted);">暂无称号出售</p>':n.map(o=>`
                        <div class="card" style="margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <span style="background: ${o.color}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: 600;">${o.name}</span>
                                    <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">${o.description||"独特的身份标识"}</p>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-weight: 700; color: #f59e0b;">${o.price}</div>
                                    <button class="btn btn-sm btn-primary" onclick="buyTitle(${o.id}, '${o.name}', ${o.price})" style="margin-top: 8px;">购买</button>
                                </div>
                            </div>
                        </div>
                    `).join("")}
                
                ${s.length>0?`
                    <h3 class="section-title" style="margin-top: 20px;">道具商店</h3>
                    ${s.map(o=>`
                        <div class="card" style="margin-bottom: 12px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                ${o.image?`<img src="${u(o.image)}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover;">`:'<div style="width: 60px; height: 60px; background: var(--bg-secondary); border-radius: 8px; display: flex; align-items: center; justify-content: center;">📦</div>'}
                                <div style="flex: 1;">
                                    <div style="font-weight: 600;">${o.name}</div>
                                    <div style="font-size: 12px; color: var(--text-muted);">${o.description||""}</div>
                                    <div style="font-size: 12px; color: var(--text-muted);">库存: ${o.stock||"无限"}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-weight: 700; color: #f59e0b;">${o.price}</div>
                                    <button class="btn btn-sm btn-primary" onclick="buyItem(${o.id}, '${o.name}', ${o.price})" style="margin-top: 8px;">购买</button>
                                </div>
                            </div>
                        </div>
                    `).join("")}
                `:""}
            </div>
        `}catch{t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}async function Ut(t,e){document.querySelectorAll("#shop-content + .btn, #shop-content ~ .btn").forEach(n=>{n.classList.remove("btn-primary"),n.classList.add("btn-secondary")}),e.classList.remove("btn-secondary"),e.classList.add("btn-primary");const i=r("shop-content");if(i){i.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{if(t==="title"){const s=((await d("/titles")).titles||[]).filter(o=>o.in_shop==1);i.innerHTML=`
                <h3 class="section-title">称号商店</h3>
                ${s.length===0?'<p style="color: var(--text-muted);">暂无称号出售</p>':s.map(o=>`
                        <div class="card" style="margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <span style="background: ${o.color}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: 600;">${o.name}</span>
                                    <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">${o.description||"独特的身份标识"}</p>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-weight: 700; color: #f59e0b;">${o.price}</div>
                                    <button class="btn btn-sm btn-primary" onclick="buyTitle(${o.id}, '${o.name}', ${o.price})" style="margin-top: 8px;">购买</button>
                                </div>
                            </div>
                        </div>
                    `).join("")}
            `}else if(t==="item"){const s=(await d("/shop/items")).items||[];i.innerHTML=`
                <h3 class="section-title">道具商店</h3>
                ${s.length===0?'<p style="color: var(--text-muted);">暂无道具出售</p>':s.map(o=>`
                        <div class="card" style="margin-bottom: 12px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                ${o.image?`<img src="${u(o.image)}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover;">`:'<div style="width: 60px; height: 60px; background: var(--bg-secondary); border-radius: 8px; display: flex; align-items: center; justify-content: center;">📦</div>'}
                                <div style="flex: 1;">
                                    <div style="font-weight: 600;">${o.name}</div>
                                    <div style="font-size: 12px; color: var(--text-muted);">${o.description||""}</div>
                                    <div style="font-size: 12px; color: var(--text-muted);">库存: ${o.stock||"无限"}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-weight: 700; color: #f59e0b;">${o.price}</div>
                                    <button class="btn btn-sm btn-primary" onclick="buyItem(${o.id}, '${o.name}', ${o.price})" style="margin-top: 8px;">购买</button>
                                </div>
                            </div>
                        </div>
                    `).join("")}
            `}else q()}catch{i.innerHTML='<div class="empty-state"><p>加载失败</p></div>'}}}window.loadShopCategory=Ut;async function tt(){const t=r("content-body");if(t){t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const i=(await d("/rankings/contribution")).rankings||[];t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            
            <div style="display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto; padding-bottom: 8px;">
                <button class="btn btn-sm btn-primary" onclick="loadRankingType('contribution')">贡献榜</button>
                <button class="btn btn-sm btn-secondary" onclick="loadRankingType('posts-likes')">点赞榜</button>
                <button class="btn btn-sm btn-secondary" onclick="loadRankingType('posts-views')">浏览榜</button>
                <button class="btn btn-sm btn-secondary" onclick="loadRankingType('checkin')">签到榜</button>
                <button class="btn btn-sm btn-secondary" onclick="loadRankingType('stock')">股市榜</button>
            </div>
            
            <div id="rankings-list">
                ${i.map((n,s)=>`
                    <div class="card" onclick="showProfile('${n.username}')" style="cursor: pointer; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="font-size: 20px; width: 32px; text-align: center;">${s<3?["🥇","🥈","🥉"][s]:s+1}</div>
                            <img src="${u(n.avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" style="width: 40px; height: 40px; border-radius: 50%;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                            <div style="flex: 1;">
                                <div style="font-weight: 600;">${n.nickname}</div>
                                <div style="font-size: 12px; color: var(--text-muted);">${(n.contribution||0).toFixed(2)}</div>
                            </div>
                        </div>
                    </div>
                `).join("")}
            </div>
        `}catch{t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}async function Ot(t){const e=r("rankings-list");if(e){e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const n=(await d(`/rankings/${t}`)).rankings||[];e.innerHTML=n.map((s,o)=>{let a=0;return t==="contribution"?a=s.contribution||0:t==="posts-likes"?a=s.likes||0:t==="posts-views"?a=s.views||0:t==="checkin"?a=s.max_continuous_days||0:t==="stock"&&(a=s.profit_loss||0),`
                <div class="card" onclick="showProfile('${s.username}')" style="cursor: pointer; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="font-size: 20px; width: 32px; text-align: center;">${o<3?["🥇","🥈","🥉"][o]:o+1}</div>
                        <img src="${u(s.avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" style="width: 40px; height: 40px; border-radius: 50%;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                        <div style="flex: 1;">
                            <div style="font-weight: 600;">${s.nickname}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">${a.toFixed?a.toFixed(2):a}</div>
                        </div>
                    </div>
                </div>
            `}).join("")}catch{e.innerHTML='<div class="empty-state"><p>加载失败</p></div>'}}}window.loadRankingType=Ot;async function B(){const t=r("content-body");if(t){if(!l.currentUser){m();return}t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const[e,i]=await Promise.all([d("/titles/my"),d("/shop/my-items")]),n=e.titles||[],s=e.equippedTitle,o=i.items||[];t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            
            <div style="display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto; padding-bottom: 8px;">
                <button class="btn btn-sm btn-primary" onclick="loadInventoryCategory('all', this)">全部</button>
                <button class="btn btn-sm btn-secondary" onclick="loadInventoryCategory('title', this)">称号</button>
                <button class="btn btn-sm btn-secondary" onclick="loadInventoryCategory('item', this)">道具</button>
            </div>
            
            <div id="inventory-content">
                <h3 class="section-title">我的称号</h3>
                ${n.length===0?'<p style="color: var(--text-muted);">暂无称号</p>':n.map(a=>`
                        <div class="card" style="margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <span style="background: ${a.color}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: 600;">${a.name}</span>
                                    <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">${a.description||""}</p>
                                </div>
                                <button class="btn btn-sm ${s===a.id?"btn-success":"btn-primary"}" onclick="equipTitle(${a.id})">
                                    ${s===a.id?"已装备":"装备"}
                                </button>
                            </div>
                        </div>
                    `).join("")}
                
                ${o.length>0?`
                    <h3 class="section-title" style="margin-top: 20px;">我的道具</h3>
                    ${o.map(a=>`
                        <div class="card" style="margin-bottom: 8px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                ${a.image?`<img src="${u(a.image)}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;">`:'<div style="width: 50px; height: 50px; background: var(--bg-secondary); border-radius: 8px; display: flex; align-items: center; justify-content: center;">📦</div>'}
                                <div style="flex: 1;">
                                    <div style="font-weight: 600;">${a.name}</div>
                                    <div style="font-size: 12px; color: var(--text-muted);">${a.description||""}</div>
                                    ${a.verification_code?`<div style="font-size: 11px; color: var(--primary); font-family: monospace;">验证码: ${a.verification_code}</div>`:""}
                                    ${a.verified_at?'<div style="font-size: 11px; color: #10b981;">已验证</div>':""}
                                </div>
                            </div>
                        </div>
                    `).join("")}
                `:""}
            </div>
        `}catch{t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}async function At(t,e){document.querySelectorAll("#inventory-content + .btn, #inventory-content ~ .btn").forEach(n=>{n.classList.remove("btn-primary"),n.classList.add("btn-secondary")}),e.classList.remove("btn-secondary"),e.classList.add("btn-primary");const i=r("inventory-content");if(i){i.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{if(t==="title"){const n=await d("/titles/my"),s=n.titles||[],o=n.equippedTitle;i.innerHTML=`
                <h3 class="section-title">我的称号</h3>
                ${s.length===0?'<p style="color: var(--text-muted);">暂无称号</p>':s.map(a=>`
                        <div class="card" style="margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <span style="background: ${a.color}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: 600;">${a.name}</span>
                                    <p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">${a.description||""}</p>
                                </div>
                                <button class="btn btn-sm ${o===a.id?"btn-success":"btn-primary"}" onclick="equipTitle(${a.id})">
                                    ${o===a.id?"已装备":"装备"}
                                </button>
                            </div>
                        </div>
                    `).join("")}
            `}else if(t==="item"){const s=(await d("/shop/my-items")).items||[];i.innerHTML=`
                <h3 class="section-title">我的道具</h3>
                ${s.length===0?'<p style="color: var(--text-muted);">暂无道具</p>':s.map(o=>`
                        <div class="card" style="margin-bottom: 8px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                ${o.image?`<img src="${u(o.image)}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;">`:'<div style="width: 50px; height: 50px; background: var(--bg-secondary); border-radius: 8px; display: flex; align-items: center; justify-content: center;">📦</div>'}
                                <div style="flex: 1;">
                                    <div style="font-weight: 600;">${o.name}</div>
                                    <div style="font-size: 12px; color: var(--text-muted);">${o.description||""}</div>
                                    ${o.verification_code?`<div style="font-size: 11px; color: var(--primary); font-family: monospace;">验证码: ${o.verification_code}</div>`:""}
                                    ${o.verified_at?'<div style="font-size: 11px; color: #10b981;">已验证</div>':""}
                                </div>
                            </div>
                        </div>
                    `).join("")}
            `}else B()}catch{i.innerHTML='<div class="empty-state"><p>加载失败</p></div>'}}}window.loadInventoryCategory=At;async function F(){const t=r("content-body");if(t){if(!l.currentUser){m();return}t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const i=(await d("/claims")).claims||[];t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            
            <div class="card">
                <h3 class="card-title">提交申报</h3>
                <div class="form-group">
                    <label>申报贡献点数量</label>
                    <input type="number" id="claim-amount" placeholder="请输入数量" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary);">
                </div>
                <div class="form-group">
                    <label>申报原因（至少10个字符）</label>
                    <textarea id="claim-reason" placeholder="请详细说明申报原因" style="width: 100%; min-height: 80px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary);"></textarea>
                </div>
                <button class="btn btn-primary btn-block" onclick="submitClaim()">提交申报</button>
            </div>
            
            <h3 class="section-title" style="margin-top: 20px;">我的申报</h3>
            ${i.length===0?'<div class="empty-state"><p>暂无申报记录</p></div>':i.map(n=>`
                    <div class="card" style="margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 24px; font-weight: 700; color: #f59e0b;">+${n.amount}</span>
                            <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; background: ${n.status==="pending"?"#fef3c7":n.status==="approved"?"#d1fae5":"#fee2e2"}; color: ${n.status==="pending"?"#92400e":n.status==="approved"?"#065f46":"#991b1b"};">
                                ${n.status==="pending"?"待审核":n.status==="approved"?"已通过":"已拒绝"}
                            </span>
                        </div>
                        <div style="color: var(--text-secondary); margin-bottom: 8px;">${n.reason}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">提交于 ${T(n.created_at)}</div>
                    </div>
                `).join("")}
        `}catch{t.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}async function Rt(t,e,i){if(!l.currentUser){m();return}if(confirm(`确定购买称号「${e}」？
价格：${i} 贡献点`))try{await d(`/titles/${t}/buy`,{method:"POST"}),c('购买成功！请在"仓库"中查看')}catch(n){c(n.message||"购买失败","error")}}async function Dt(t){try{await d("/titles/equip",{method:"PUT",body:JSON.stringify({titleId:t})}),c("装备成功"),B()}catch(e){c(e.message||"装备失败","error")}}async function Nt(){var i,n;const t=parseInt((i=r("claim-amount"))==null?void 0:i.value),e=(n=r("claim-reason"))==null?void 0:n.value.trim();if(!t||t<=0){c("请输入有效的申报数量","error");return}if(!e||e.length<10){c("申报原因至少10个字符","error");return}try{await d("/claims",{method:"POST",body:JSON.stringify({amount:t,reason:e})}),c("申报提交成功，请等待管理员审核"),F()}catch(s){c(s.message||"提交失败","error")}}async function qt(t,e,i){if(!l.currentUser){m();return}if(confirm(`确定购买「${e}」？
价格：${i} 贡献点`))try{await d(`/shop/items/${t}/buy`,{method:"POST"}),c("购买成功！")}catch(n){c(n.message||"购买失败","error")}}
