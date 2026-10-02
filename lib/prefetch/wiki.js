/**
 * Wiki 的预取 Provider（SSG）
 *
 * 覆盖 /wiki、/wiki/category/:slug、/wiki/:slug 三条内容路由；
 * /wiki/search（查询相关）与 /wiki/editor（仅管理员）不预渲染，保持 SPA/SSR 之外的默认行为。
 *
 * 返回的 key 与前端页面 useServerData(...) 的参数一一对应：
 *   wikiHome / wikiCategory / wikiPage / wikiTree
 */
const wiki = require('../wiki');

const SSG = [
    /^\/wiki\/?$/,
    /^\/wiki\/category\/[^/]+$/,
    /^\/wiki\/[a-z0-9-]+$/
];

/** 这些路径会被上面的正则误伤，明确排除（保持 SPA） */
const EXCLUDE = [/^\/wiki\/search/, /^\/wiki\/editor/];

function matches(pathname) {
    if (EXCLUDE.some(re => re.test(pathname))) return false;
    return SSG.some(re => re.test(pathname));
}

async function load(pathname) {
    const clean = pathname.replace(/\?.*$/, '');

    // 首页：分类树 + 精选/最近/热门/贡献者
    if (/^\/wiki\/?$/.test(clean)) {
        const home = await wiki.wikiHomeData();
        return { wikiHome: home, wikiTree: home.categories };
    }

    // 分类页
    const mCat = clean.match(/^\/wiki\/category\/([^/]+)$/);
    if (mCat) {
        const slug = decodeURIComponent(mCat[1]);
        const category = await wiki.getCategoryBySlug(slug);
        if (!category || !category.is_active) return null;
        const tree = await wiki.getCategoryTree();
        const flat = (function walk(nodes, out = []) {
            for (const n of nodes) { out.push(n); walk(n.children || [], out); }
            return out;
        })(tree);
        const children = flat.filter(n => n.parent_id === category.id)
            .map(n => ({ id: n.id, name: n.name, slug: n.slug, page_count: n.page_count }));
        const list = await wiki.listPages({
            categoryId: category.id, includeChildCategories: true,
            status: 'published', page: 1, limit: 12, sort: 'updated'
        });
        return {
            wikiTree: tree,
            wikiCategory: {
                category, children,
                breadcrumb: await wiki.categoryBreadcrumb(category.id),
                ...list
            }
        };
    }

    // 文章页
    const mPage = clean.match(/^\/wiki\/([a-z0-9-]+)$/);
    if (mPage) {
        const page = await wiki.getPageBySlug(mPage[1]);
        if (!page || page.status !== 'published') return null;
        const [content_html, breadcrumb, related, neighbors, tree] = await Promise.all([
            wiki.renderContent(page.content),
            wiki.categoryBreadcrumb(page.category_id),
            wiki.relatedPages(page.id, 8),
            wiki.getNeighbors(page),
            wiki.getCategoryTree()
        ]);
        return {
            wikiTree: tree,
            wikiPage: {
                page: { ...page, content_html },
                content_html,
                breadcrumb,
                related,
                neighbors,
                can_edit: false          // 服务端按游客渲染，登录态由客户端接管
            }
        };
    }

    return null;
}

/** SSG 需要生成的完整路径列表 */async function enumerate() {
    const urls = ['/wiki'];
    const cats = await wiki.listCategories();
    for (const c of cats) urls.push(`/wiki/category/${c.slug}`);
    const pages = await wiki.listPages({ status: 'published', page: 1, limit: 1000, sort: 'title' });
    for (const p of pages.pages) urls.push(`/wiki/${p.slug}`);
    return urls;
}

/** 每页动态 head（title / description / OG 图） */
function head(data) {
    const p = data && data.wikiPage && data.wikiPage.page;
    if (p) {
        return {
            title: `${p.title} · 玄剑 Wiki`,
            description: p.summary || '',
            image: p.cover_image || undefined
        };
    }
    const c = data && data.wikiCategory && data.wikiCategory.category;
    if (c) {
        return {
            title: `${c.name} · 玄剑 Wiki`,
            description: c.description || `玄剑 Wiki 分类：${c.name}`
        };
    }
    return {
        title: '玄剑 Wiki · 玄剑公会知识库',
        description: '公会制度、通史档案、Minecraft 资料与项目文档，长期维护、随时查阅。'
    };
}

module.exports = {
    name: 'wiki',
    ssg: SSG,
    ssr: [],
    matches,
    load,
    enumerate,
    head
};
