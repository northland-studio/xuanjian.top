(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))i(o);new MutationObserver(o=>{for(const r of o)if(r.type==="childList")for(const c of r.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&i(c)}).observe(document,{childList:!0,subtree:!0});function n(o){const r={};return o.integrity&&(r.integrity=o.integrity),o.referrerPolicy&&(r.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?r.credentials="include":o.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(o){if(o.ep)return;o.ep=!0;const r=n(o);fetch(o.href,r)}})();const K="modulepreload",G=function(t,e){return new URL(t,e).href},z={},Q=function(e,n,i){let o=Promise.resolve();if(n&&n.length>0){let c=function(v){return Promise.all(v.map(h=>Promise.resolve(h).then(w=>({status:"fulfilled",value:w}),w=>({status:"rejected",reason:w}))))};const d=document.getElementsByTagName("link"),u=document.querySelector("meta[property=csp-nonce]"),m=(u==null?void 0:u.nonce)||(u==null?void 0:u.getAttribute("nonce"));o=c(n.map(v=>{if(v=G(v,i),v in z)return;z[v]=!0;const h=v.endsWith(".css"),w=h?'[rel="stylesheet"]':"";if(!!i)for(let L=d.length-1;L>=0;L--){const T=d[L];if(T.href===v&&(!h||T.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${v}"]${w}`))return;const f=document.createElement("link");if(f.rel=h?"stylesheet":K,h||(f.as="script"),f.crossOrigin="",f.href=v,m&&f.setAttribute("nonce",m),document.head.appendChild(f),h)return new Promise((L,T)=>{f.addEventListener("load",L),f.addEventListener("error",()=>T(new Error(`Unable to preload CSS for ${v}`)))})}))}function r(c){const d=new Event("vite:preloadError",{cancelable:!0});if(d.payload=c,window.dispatchEvent(d),!d.defaultPrevented)throw c}return o.then(c=>{for(const d of c||[])d.status==="rejected"&&r(d.reason);return e().catch(r)})},D="https://xuanjian.top/api",a={token:localStorage.getItem("token"),currentUser:JSON.parse(localStorage.getItem("user")||"null"),currentPage:"home",sidebarOpen:!1,theme:localStorage.getItem("theme")||"light"},N="https://xuanjian.top",s=t=>document.getElementById(t);function g(t){return t?t.startsWith("data:")||t.startsWith("http://")||t.startsWith("https://")?t:t.startsWith("/")?`${N}${t}`:`${N}/${t}`:""}document.addEventListener("DOMContentLoaded",()=>{X(),Z(),tt(),a.currentUser&&(et(),B()),S()});function X(){const t=localStorage.getItem("theme")||"light";document.documentElement.setAttribute("data-theme",t),a.theme=t;const e=s("themeToggle");e==null||e.addEventListener("click",Y)}function Y(){const t=a.theme==="light"?"dark":"light";a.theme=t,document.documentElement.setAttribute("data-theme",t),localStorage.setItem("theme",t)}function Z(){const t=s("menuToggle"),e=s("sidebarOverlay");t==null||t.addEventListener("click",()=>C(!0)),e==null||e.addEventListener("click",()=>C(!1)),document.querySelectorAll(".nav-item").forEach(i=>{i.addEventListener("click",o=>{o.preventDefault();const r=i.dataset.page;r&&(J(r),C(!1))})});const n=s("userInfo");n==null||n.addEventListener("click",()=>{a.currentUser?W(a.currentUser.username):k(),C(!1)})}function C(t){const e=s("sidebar"),n=s("sidebarOverlay");t?(e==null||e.classList.add("open"),n==null||n.classList.add("active")):(e==null||e.classList.remove("open"),n==null||n.classList.remove("active")),a.sidebarOpen=t}async function J(t){switch(document.querySelectorAll(".nav-item").forEach(e=>{e.classList.toggle("active",e.getAttribute("data-page")===t)}),a.currentPage=t,t){case"home":await S();break;case"daily":await _("daily");break;case"decision":await _("decision");break;case"forum":await _("forum");break;case"social":ot();break;case"notifications":await bt();break}}function tt(){M()}function M(){const t=s("userInfo");if(t)if(a.currentUser){const e=g(a.currentUser.avatar);t.innerHTML=`
            <div class="user-avatar-placeholder">
                ${e?`<img src="${e}" alt="" onerror="this.parentElement.innerHTML='<svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><path d=\\'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\\'></path><circle cx=\\'12\\' cy=\\'7\\' r=\\'4\\'></circle></svg>'">`:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'}
            </div>
            <div class="user-details">
                <div class="user-name">${a.currentUser.nickname}</div>
                <div class="user-handle">@${a.currentUser.username}</div>
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
        `}async function et(){if(a.token)try{const t=await p("/auth/me");a.currentUser=t,localStorage.setItem("user",JSON.stringify(t)),M()}catch(t){console.error("刷新用户信息失败:",t)}}async function p(t,e){const n=`${D}${t}`,i={"Content-Type":"application/json",...e==null?void 0:e.headers};a.token&&(i.Authorization=`Bearer ${a.token}`);const o=await fetch(n,{...e,headers:i});if(!o.ok){const r=await o.json().catch(()=>({error:"请求失败"}));throw new Error(r.error||"请求失败")}return o.json()}function l(t,e="success"){const n=s("toast-container");if(!n)return;const i=document.createElement("div");i.className=`toast ${e}`,i.textContent=t,n.appendChild(i),setTimeout(()=>i.remove(),3e3)}function P(t){if(!t)return"未知";const e=new Date(t);if(isNaN(e.getTime()))return"未知";const i=new Date().getTime()-e.getTime(),o=Math.floor(i/6e4),r=Math.floor(i/36e5),c=Math.floor(i/864e5);return o<1?"刚刚":o<60?`${o}分钟前`:r<24?`${r}小时前`:c<7?`${c}天前`:e.toLocaleDateString("zh-CN")}async function B(){if(a.token)try{const t=await p("/notifications?limit=1"),e=s("sidebar-notification-badge");e&&(t.unreadCount>0?(e.textContent=t.unreadCount>99?"99+":t.unreadCount.toString(),e.style.display="inline"):e.style.display="none")}catch{}}async function S(){const t=s("content-body");t&&(t.innerHTML=`
        <div class="home-header">
            <h1>欢迎来到玄剑公会</h1>
            <p>我的世界玄剑公会官方社区</p>
            ${a.currentUser?`<button class="btn btn-primary" onclick="showEditorPage()" style="margin-top: 16px;">
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
    `,nt(),it())}async function nt(){try{const t=await p("/posts?type=daily&limit=3"),e=s("home-daily-list");if(!e)return;if(t.posts.length===0){e.innerHTML='<div class="empty-state"><p>暂无日报</p></div>';return}e.innerHTML=t.posts.map(n=>E(n)).join(""),U()}catch{const e=s("home-daily-list");e&&(e.innerHTML='<div class="empty-state"><p>加载失败</p></div>')}}async function it(){try{const t=await p("/posts?type=decision&limit=3"),e=s("home-decision-list");if(!e)return;if(t.posts.length===0){e.innerHTML='<div class="empty-state"><p>暂无决策</p></div>';return}e.innerHTML=t.posts.map(n=>E(n)).join(""),U()}catch{const e=s("home-decision-list");e&&(e.innerHTML='<div class="empty-state"><p>加载失败</p></div>')}}async function _(t){const e=s("content-body");if(e){e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const n=await p(`/posts?type=${t}&limit=50`);if(n.posts.length===0){e.innerHTML='<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><h3>暂无内容</h3></div>';return}e.innerHTML=n.posts.map(i=>E(i)).join(""),U()}catch{e.innerHTML='<div class="empty-state"><h3>加载失败</h3></div>'}}}function E(t){const e=a.currentUser&&a.currentUser.id===t.author_id;return`
        <div class="post-item" data-id="${t.id}">
            <div class="post-header">
                <img src="${g(t.author_avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <div class="post-author">
                    <div class="post-author-name">${t.author_nickname||"未知用户"}</div>
                    <div class="post-time">${P(t.created_at)}</div>
                </div>
                ${t.is_pinned?'<span class="tag">置顶</span>':""}
                ${e?`<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); editPost(${t.id})">编辑</button>`:""}
            </div>
            <div class="post-title">${b(t.title)}</div>
            <div class="post-content">${Pt(t.content).substring(0,150)}${t.content.length>150?"...":""}</div>
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
    `}function U(){document.querySelectorAll(".post-item").forEach(t=>{t.addEventListener("click",()=>{const e=t.dataset.id;e&&I(parseInt(e))})})}function ot(){const t=s("content-body");t&&(t.innerHTML=`
        <div class="card">
            <h3 class="card-title">社交媒体</h3>
            <p style="color: var(--text-secondary); margin-top: 8px;">敬请期待...</p>
        </div>
    `)}async function I(t){const e=s("content-body");if(e){e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const n=await p(`/posts/${t}`),i=n.post,o=a.currentUser&&a.currentUser.id===i.author_id;e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card">
                <div class="post-header">
                    <img src="${g(i.author_avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                    <div class="post-author">
                        <div class="post-author-name">${i.author_nickname||"未知用户"}</div>
                        <div class="post-time">${P(i.created_at)}</div>
                    </div>
                    ${o?`<button class="btn btn-sm btn-secondary" onclick="editPost(${t})">编辑</button>`:""}
                </div>
                <h2 style="font-size: 18px; margin-bottom: 12px;">${b(i.title)}</h2>
                <div class="post-content-full">${i.content||""}</div>
                ${i.images&&i.images.length>0?`
                    <div class="post-images" style="margin-top: 16px;">
                        ${i.images.map(r=>`<img src="${g(r)}" onclick="previewImage('${g(r)}')" style="cursor: pointer;">`).join("")}
                    </div>
                `:""}
                <div class="post-footer" style="margin-top: 16px;">
                    <span class="post-stat">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        ${i.views}
                    </span>
                    <span class="post-stat" onclick="toggleLike(${t})" style="cursor: pointer;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="${i.isLiked?"currentColor":"none"}" stroke="currentColor" stroke-width="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                        ${i.likes}
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
            
            <h3 class="section-title" style="margin-top: 20px;">评论 (${n.comments.length})</h3>
            <div id="comments-list">
                ${n.comments.length===0?'<div class="empty-state"><p>暂无评论，快来抢沙发吧！</p></div>':n.comments.map(r=>V(r)).join("")}
            </div>
        `}catch{e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}function V(t){var i;const e=((i=t.replies)==null?void 0:i.map(o=>V(o)).join(""))||"",n=t.reply_to?`<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">回复 @${t.reply_to.nickname}</div>`:"";return`
        <div class="card">
            <div class="post-header">
                <img src="${g(t.author_avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" class="post-avatar" alt="" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <div class="post-author">
                    <div class="post-author-name">${t.author_nickname}</div>
                    <div class="post-time">${P(t.created_at)}</div>
                </div>
            </div>
            ${n}
            <div style="color: var(--text-secondary);">${b(t.content)}</div>
            <div style="margin-top: 8px;">
                <button class="btn btn-sm btn-secondary" onclick="setReplyTo(${t.id}, '${b(t.author_nickname||"")}')">回复</button>
            </div>
            ${e?`<div style="margin-top: 12px; padding-left: 12px; border-left: 2px solid var(--border);">${e}</div>`:""}
        </div>
    `}let A=null;function st(t,e){A=t;const n=s("reply-info"),i=s("reply-to-name");n&&i&&(i.textContent=`回复 @${e}`,n.style.display="block");const o=s("comment-input");o&&o.focus()}function rt(){A=null;const t=s("reply-info");t&&(t.style.display="none")}async function at(t){if(!a.currentUser){k();return}const e=s("comment-input"),n=e==null?void 0:e.value.trim();if(!n){l("请输入评论内容","error");return}try{await p(`/posts/${t}/comments`,{method:"POST",body:JSON.stringify({content:n,parentId:A})}),l("评论成功"),I(t)}catch(i){l(i.message||"评论失败","error")}}function q(){J(a.currentPage)}async function ct(t){if(!a.currentUser){k();return}try{await p(`/posts/${t}/like`,{method:"POST"}),I(t)}catch{l("操作失败","error")}}async function W(t){var n;const e=s("content-body");if(e){e.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const o=(await p(`/auth/user/${t}`)).user,r=((n=a.currentUser)==null?void 0:n.username)===t;e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card" style="text-align: center;">
                <img src="${g(o.avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" style="width: 80px; height: 80px; border-radius: 50%; margin-bottom: 16px;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
                <h2 style="margin-bottom: 8px;">${o.nickname}</h2>
                <p style="color: var(--text-muted); margin-bottom: 8px;">@${o.username}</p>
                <span class="tag">${o.level>=2?"超级管理员":o.level>=1?"管理员":"普通成员"}</span>
            </div>
            
            <div class="card">
                <h3 class="card-title">账号信息</h3>
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <span style="color: var(--text-secondary);">邮箱</span>
                    <span>${o.email||"未设置"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border);">
                    <span style="color: var(--text-secondary);">邮箱验证</span>
                    <span style="color: ${o.is_email_verified?"var(--success)":"var(--warning)"};">${o.is_email_verified?"已验证":"未验证"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 12px 0;">
                    <span style="color: var(--text-secondary);">注册时间</span>
                    <span>${P(o.created_at)}</span>
                </div>
            </div>
            
            ${r?`
                <button class="btn btn-secondary btn-block" onclick="showSettingsPage()" style="margin-top: 12px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    账号设置
                </button>
                
                ${o.level>=1?`
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
        `;try{const c=await p(`/posts?author=${t}&limit=20`),d=s("profile-posts-list");d&&(c.posts.length>0?(d.innerHTML=c.posts.map(u=>E(u)).join(""),U()):d.innerHTML='<div class="empty-state"><p>暂无帖子</p></div>')}catch{const c=s("profile-posts-list");c&&(c.innerHTML='<div class="empty-state"><p>加载失败</p></div>')}}catch{e.innerHTML=`
            <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>用户不存在</h3></div>
        `}}}function lt(){const t=s("content-body");if(!t||!a.currentUser)return;const e=a.currentUser;t.innerHTML=`
        <button class="btn btn-secondary" onclick="showProfile('${e.username}')" style="margin-bottom: 16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M19 12H5M12 19l-7-7 7-7"></path>
            </svg>
            返回
        </button>
        
        <div class="card">
            <h3 class="card-title">修改头像</h3>
            <div style="text-align: center; margin-bottom: 16px;">
                <img id="settings-avatar-preview" src="${g(e.avatar)||"https://xuanjian.top/uploads/default-avatar.png"}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 12px;" onerror="this.src='https://xuanjian.top/uploads/default-avatar.png'">
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
    `}async function dt(){const t=await O();if(t){const e=s("settings-avatar-preview");e&&(e.src=t),l("头像已上传，请保存资料")}}async function pt(){var i,o,r;const t=(i=s("settings-nickname"))==null?void 0:i.value.trim(),e=(o=s("settings-email"))==null?void 0:o.value.trim(),n=(r=s("settings-avatar-preview"))==null?void 0:r.src;if(!t){l("请输入昵称","error");return}try{const c={nickname:t,email:e};n&&!n.includes("default-avatar")&&(c.avatar=n);const d=await p("/auth/profile",{method:"PUT",body:JSON.stringify(c)});d.user&&(a.currentUser=d.user,localStorage.setItem("user",JSON.stringify(d.user))),M(),l("保存成功")}catch(c){l(c.message||"保存失败","error")}}async function ut(){var i,o,r;const t=(i=s("settings-old-password"))==null?void 0:i.value,e=(o=s("settings-new-password"))==null?void 0:o.value,n=(r=s("settings-confirm-password"))==null?void 0:r.value;if(!t||!e||!n){l("请填写完整信息","error");return}if(e!==n){l("两次密码不一致","error");return}if(e.length<6){l("密码至少6位","error");return}try{await p("/auth/password",{method:"PUT",body:JSON.stringify({oldPassword:t,newPassword:e})}),l("密码修改成功"),s("settings-old-password").value="",s("settings-new-password").value="",s("settings-confirm-password").value=""}catch(c){l(c.message||"修改失败","error")}}let x=null,y=[];function H(t){if(!s("content-body"))return;if(!a.currentUser){k();return}x=t||null,y=[];let n={title:"",content:"",type:"forum",images:[]};t?p(`/posts/${t}`).then(i=>{n={title:i.post.title,content:i.post.content,type:i.post.type,images:i.post.images||[]},y=n.images,R(n)}).catch(()=>{l("加载帖子失败","error")}):R(n)}function R(t){const e=s("content-body");if(!e)return;const n=a.currentUser&&a.currentUser.level>=1;e.innerHTML=`
        <button class="btn btn-secondary" onclick="goBack()" style="margin-bottom: 16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M19 12H5M12 19l-7-7 7-7"></path>
            </svg>
            返回
        </button>
        
        <div class="card">
            <h3 class="card-title">${x?"编辑帖子":"发布新帖"}</h3>
            
            <div class="form-group">
                <label>标题</label>
                <input type="text" id="editor-title" value="${b(t.title)}" placeholder="请输入标题">
            </div>
            
            <div class="form-group">
                <label>类型</label>
                <select id="editor-type" style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary);">
                    <option value="forum" ${t.type==="forum"?"selected":""}>贴吧</option>
                    ${n?`
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
                <textarea id="editor-content" placeholder="请输入内容..." style="width: 100%; min-height: 200px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); resize: vertical; line-height: 1.6;">${b(t.content)}</textarea>
            </div>
            
            <div id="editor-images" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
                ${y.map((i,o)=>`
                    <div style="position: relative; width: 80px; height: 80px;">
                        <img src="${g(i)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">
                        <button onclick="removeEditorImage(${o})" style="position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; border-radius: 50%; background: var(--danger); color: white; border: none; font-size: 14px;">x</button>
                    </div>
                `).join("")}
            </div>
            
            <button class="btn btn-primary btn-block" onclick="submitPost()">
                ${x?"保存修改":"发布"}
            </button>
        </div>
    `}function vt(t){const e=s("editor-content");if(!e)return;const n=e.selectionStart,i=e.selectionEnd,o=e.value.substring(n,i),r={bold:["<strong>","</strong>"],italic:["<em>","</em>"],underline:["<u>","</u>"]},[c,d]=r[t]||["",""];e.value=e.value.substring(0,n)+c+o+d+e.value.substring(i),e.focus(),e.selectionStart=n+c.length,e.selectionEnd=n+c.length+o.length}async function ht(){const t=await O();if(t){y.push(t);const e=s("editor-images");if(e){const n=document.createElement("div");n.style.cssText="position: relative; width: 80px; height: 80px;",n.innerHTML=`
                <img src="${g(t)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">
                <button onclick="removeEditorImage(${y.length-1})" style="position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; border-radius: 50%; background: var(--danger); color: white; border: none; font-size: 14px;">x</button>
            `,e.appendChild(n)}}}function gt(t){y.splice(t,1),x?H(x):H()}async function mt(){var i,o,r;const t=(i=s("editor-title"))==null?void 0:i.value.trim(),e=(o=s("editor-type"))==null?void 0:o.value,n=(r=s("editor-content"))==null?void 0:r.value.trim();if(!t||!n){l("请填写标题和内容","error");return}try{x?(await p(`/posts/${x}`,{method:"PUT",body:JSON.stringify({title:t,content:n,images:y})}),l("修改成功")):(await p("/posts",{method:"POST",body:JSON.stringify({title:t,content:n,type:e,images:y})}),l("发布成功")),q()}catch(c){l(c.message||"操作失败","error")}}function ft(t){H(t)}async function yt(){var e,n;const t=s("content-body");if(!(!t||!a.currentUser||a.currentUser.level<1)){t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const i=await p("/admin/stats");t.innerHTML=`
            <button class="btn btn-secondary" onclick="showProfile('${(e=a.currentUser)==null?void 0:e.username}')" style="margin-bottom: 16px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                    <path d="M19 12H5M12 19l-7-7 7-7"></path>
                </svg>
                返回
            </button>
            
            <div class="card">
                <h3 class="card-title">系统统计</h3>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${i.totalUsers}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">用户数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${i.totalPosts}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">帖子数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${i.totalComments}</div>
                        <div style="color: var(--text-secondary); font-size: 12px;">评论数</div>
                    </div>
                    <div style="text-align: center; padding: 16px; background: var(--bg-tertiary); border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: var(--primary);">${i.totalViews}</div>
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
            <button class="btn btn-secondary" onclick="showProfile('${(n=a.currentUser)==null?void 0:n.username}')" style="margin-bottom: 16px;">返回</button>
            <div class="empty-state"><h3>加载失败</h3></div>
        `}}}async function bt(){const t=s("content-body");if(t){if(!a.currentUser){k();return}t.innerHTML='<div class="loading-spinner"><div class="spinner"></div></div>';try{const e=await p("/notifications");if(e.notifications.length===0){t.innerHTML=`
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <h3>暂无通知</h3>
                </div>
            `;return}t.innerHTML=e.notifications.map(n=>wt(n)).join(""),document.querySelectorAll(".notification-item").forEach(n=>{n.addEventListener("click",async()=>{const i=n.dataset.id,o=n.dataset.postId;i&&(await p(`/notifications/${i}/read`,{method:"PUT"}),B()),o&&I(parseInt(o))})})}catch{t.innerHTML='<div class="empty-state"><h3>加载失败</h3></div>'}}}function wt(t){const e={post_daily:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',post_decision:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>',comment:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',like:'<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>'},n={post_daily:"daily",post_decision:"decision",comment:"comment",like:"like"};return`
        <div class="notification-item ${t.is_read?"":"unread"}" data-id="${t.id}" data-post-id="${t.post_id||""}">
            <div class="notification-icon ${n[t.type]||"daily"}">
                ${e[t.type]||""}
            </div>
            <div class="notification-content">
                <div class="notification-title">${b(t.title)}</div>
                <div class="notification-text">${b(t.content||t.post_title||"")}</div>
                <div class="notification-meta">${P(t.created_at)}${t.actor_nickname?` · 来自 ${t.actor_nickname}`:""}</div>
            </div>
        </div>
    `}function k(){const t=s("login-modal");t==null||t.classList.add("active")}function j(){const t=s("login-modal");t==null||t.classList.remove("active")}function xt(){j();const t=s("register-modal");t==null||t.classList.add("active")}function F(){const t=s("register-modal");t==null||t.classList.remove("active")}async function kt(){var n,i;const t=(n=s("login-username"))==null?void 0:n.value.trim(),e=(i=s("login-password"))==null?void 0:i.value;if(!t||!e){l("请填写用户名和密码","error");return}try{const o=await p("/auth/login",{method:"POST",body:JSON.stringify({username:t,password:e})});a.token=o.token,a.currentUser=o.user,localStorage.setItem("token",o.token),localStorage.setItem("user",JSON.stringify(o.user)),j(),M(),B(),l("登录成功"),S()}catch(o){l(o.message||"登录失败","error")}}let $=0;async function $t(){var e;const t=(e=s("register-email"))==null?void 0:e.value.trim();if(!t){l("请输入邮箱","error");return}if($>0){l(`请等待 ${$} 秒`,"error");return}try{await p("/auth/send-code",{method:"POST",body:JSON.stringify({email:t})}),l("验证码已发送"),$=60;const n=s("send-code-btn");if(n){const i=setInterval(()=>{$--,$>0?n.textContent=`${$}s`:(n.textContent="发送验证码",clearInterval(i))},1e3)}}catch(n){l(n.message||"发送失败","error")}}async function Lt(){var r,c,d,u,m;const t=(r=s("register-username"))==null?void 0:r.value.trim(),e=(c=s("register-nickname"))==null?void 0:c.value.trim(),n=(d=s("register-email"))==null?void 0:d.value.trim(),i=(u=s("register-password"))==null?void 0:u.value,o=(m=s("register-code"))==null?void 0:m.value.trim();if(!t||!e||!n||!i||!o){l("请填写完整信息","error");return}try{await p("/auth/register",{method:"POST",body:JSON.stringify({username:t,nickname:e,email:n,password:i,code:o})}),l("注册成功，请登录"),F(),k()}catch(v){l(v.message||"注册失败","error")}}function Mt(){a.token=null,a.currentUser=null,localStorage.removeItem("token"),localStorage.removeItem("user"),M(),l("已退出登录"),S()}function b(t){if(!t)return"";const e=document.createElement("div");return e.textContent=t,e.innerHTML}function Pt(t){if(!t)return"";const e=document.createElement("div");return e.innerHTML=t,e.textContent||e.innerText||""}window.previewImage=t=>{var n;let e=document.querySelector(".image-preview-modal");e?(n=e.querySelector("img"))==null||n.setAttribute("src",t):(e=document.createElement("div"),e.className="image-preview-modal",e.innerHTML=`
            <button class="image-preview-close" onclick="closeImagePreview()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <img src="${t}">
        `,e.addEventListener("click",i=>{i.target===e&&e.classList.remove("active")}),document.body.appendChild(e)),e.classList.add("active")};window.closeImagePreview=()=>{const t=document.querySelector(".image-preview-modal");t&&t.classList.remove("active")};window.showLoginModal=k;window.hideLoginModal=j;window.showRegisterModal=xt;window.hideRegisterModal=F;window.handleLogin=kt;window.handleRegister=Lt;window.handleLogout=Mt;window.sendVerificationCode=$t;window.toggleLike=ct;window.showSettingsPage=lt;window.showEditorPage=H;window.showAdminPage=yt;window.showProfile=W;window.goBack=q;window.setReplyTo=st;window.cancelReply=rt;window.submitComment=at;window.editPost=ft;window.editorAction=vt;window.addEditorImage=ht;window.removeEditorImage=gt;window.submitPost=mt;async function O(){try{const{Camera:t,CameraResultType:e}=await Q(async()=>{const{Camera:h,CameraResultType:w}=await import("./index-BYDggx_w.js");return{Camera:h,CameraResultType:w}},[],import.meta.url),n=await t.getPhoto({quality:90,allowEditing:!1,resultType:e.Base64}),i=atob(n.base64String),o=new Array(i.length);for(let h=0;h<i.length;h++)o[h]=i.charCodeAt(h);const r=new Uint8Array(o),c=new Blob([r],{type:"image/jpeg"}),d=new File([c],`photo_${Date.now()}.jpg`,{type:"image/jpeg"}),u=new FormData;u.append("image",d);const m=await fetch(`${D}/upload/image`,{method:"POST",headers:{Authorization:`Bearer ${a.token}`},body:u});if(!m.ok)throw new Error("上传失败");return(await m.json()).url}catch(t){return console.error("图片上传失败:",t),l("图片上传失败","error"),null}}window.selectAndUploadImage=O;window.selectAvatar=dt;window.saveProfile=pt;window.changePassword=ut;
