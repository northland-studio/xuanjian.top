import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { api, uploadImage } from '../api';
import { useToast } from './UI';

const lowlight = createLowlight(common);

/* ---------- 工具栏 SVG 图标（替代 emoji，风格对齐 ChatIcons.jsx：24 视框 / 线性描边 / currentColor） ---------- */
const ICON_PROPS = {
  width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': 'true', focusable: 'false'
};

/** 普通外链 */
const IconLink = () => (
  <svg {...ICON_PROPS}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

/** Wiki 内链 [[页面名]]：文档 + 双方括号 */
const IconWikiLink = () => (
  <svg {...ICON_PROPS}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9.8 12.4 8.2 14.6l1.6 2.2" />
    <path d="M14.2 12.4l1.6 2.2-1.6 2.2" />
  </svg>
);

/** 图片 */
const IconImage = () => (
  <svg {...ICON_PROPS}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 16.5 16 11.5 7 20.5" />
  </svg>
);

/** 成员卡片 */
const IconMember = () => (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20.5v-1a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5v1" />
  </svg>
);

/** 代系卡片：纪念建筑 */
const IconGeneration = () => (
  <svg {...ICON_PROPS}>
    <path d="M2.5 10 12 4l9.5 6" />
    <path d="M5 10.6V20" /><path d="M9.7 10.6V20" /><path d="M14.3 10.6V20" /><path d="M19 10.6V20" />
    <path d="M3 20.5h18" />
  </svg>
);

/** 撤销 */
const IconUndo = () => (
  <svg {...ICON_PROPS}>
    <polyline points="9 14 4 9 9 4" />
    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </svg>
);

/** 重做 */
const IconRedo = () => (
  <svg {...ICON_PROPS}>
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </svg>
);

/**
 * Wiki 富文本编辑器
 * 在现有 RichTextEditor（Tiptap）基础上扩展：表格 / 任务清单 / 代码高亮 / 图集与粘贴上传 /
 * [[Wiki 内链]] 自动补全 / {{member:}} {{generation:}} 卡片插入。
 * 帖子编辑器（RichTextEditor）保持不动，避免影响既有内容。
 */
export default function WikiRichEditor({ value, onChange, placeholder = '开始撰写…  支持 [[页面名]] 内链、表格、任务清单、代码块', minHeight = 460 }) {
  const { showToast } = useToast();
  const [linkPopup, setLinkPopup] = useState(null);   // { top, left, query, items }
  const [memberPopup, setMemberPopup] = useState(null);
  const fileRef = useRef(null);
  const wrapRef = useRef(null);
  const uploadingRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder })
    ],
    content: value || '',
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getHTML());
      detectWikiLinkTyping(ed);
    },
    editorProps: {
      attributes: { class: 'wiki-editor-content', style: `min-height: ${minHeight}px` },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
        if (files.length) {
          event.preventDefault();
          uploadAndInsert(files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (files.length) {
          event.preventDefault();
          uploadAndInsert(files);
          return true;
        }
        return false;
      }
    }
  });

  /* ---------- 图片上传（支持多选/粘贴/拖拽） ---------- */
  const uploadAndInsert = useCallback(async (files) => {
    if (!editor || uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      for (const f of files) {
        if (f.size > 8 * 1024 * 1024) { showToast(`${f.name} 超过 8MB，已跳过`, 'error'); continue; }
        const url = await uploadImage(f);
        editor.chain().focus().setImage({ src: url, alt: f.name }).run();
      }
      showToast(`已插入 ${files.length} 张图片`, 'success');
    } catch (e) {
      showToast(e.message || '图片上传失败', 'error');
    } finally {
      uploadingRef.current = false;
    }
  }, [editor, showToast]);

  /* ---------- [[内链]] 自动补全 ---------- */
  const detectWikiLinkTyping = (ed) => {
    const { from } = ed.state.selection;
    const textBefore = ed.state.doc.textBetween(Math.max(0, from - 60), from, '\n', '\n');
    const m = textBefore.match(/\[\[([^\[\]]{0,40})$/);
    if (!m) { setLinkPopup(null); return; }
    const query = m[1];
    const coords = ed.view.coordsAtPos(from);
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    api.get(`/api/wiki/search?q=${encodeURIComponent(query)}&limit=6`)
      .then(d => {
        setLinkPopup({
          query,
          items: d.pages || [],
          top: coords.bottom - (wrapRect?.top || 0) + 6,
          left: Math.max(0, coords.left - (wrapRect?.left || 0))
        });
      })
      .catch(() => setLinkPopup(null));
  };

  const insertWikiLink = (page) => {
    if (!editor || !linkPopup) return;
    const { from } = editor.state.selection;
    const start = from - linkPopup.query.length - 2;   // 去掉已输入的 "[[query"
    editor.chain().focus().deleteRange({ from: start, to: from }).insertContent(`[[${page.title}]]`).run();
    setLinkPopup(null);
  };

  /* ---------- 成员 / 代系卡片 ---------- */
  const openMemberPicker = async () => {
    const kw = window.prompt('输入成员昵称 / 用户ID / 账号ID（留空可先在 GMIRS 查询）');
    if (!kw) return;
    try {
      const d = await api.get(`/api/gmirs/query?keyword=${encodeURIComponent(kw.trim())}`);
      const list = d.users || [];
      if (!list.length) return showToast('没找到成员', 'error');
      const picked = list.length === 1 ? list[0] : (() => {
        const idx = window.prompt(`匹配到 ${list.length} 人，输入序号：\n` + list.map((u, i) => `${i + 1}. ${u.nickname || u.username}（账号ID ${u.id}）`).join('\n'), '1');
        return list[(Number(idx) || 1) - 1];
      })();
      if (!picked) return;
      editor?.chain().focus().insertContent(`{{member:${picked.id}}}`).run();
      showToast('已插入成员卡片', 'success');
    } catch (e) {
      showToast(e.message || '插入成员失败', 'error');
    }
  };

  const insertGeneration = async () => {
    try {
      const d = await api.get('/api/generations');
      const gens = d.generations || [];
      if (!gens.length) return showToast('还没有代系配置', 'error');
      const idx = window.prompt('选择代系（输入序号）：\n' + gens.map((g, i) => `${i + 1}. ${g.name}（${g.start_date || '?'} ~ ${g.end_date || '至今'}）`).join('\n'), '1');
      const g = gens[(Number(idx) || 1) - 1];
      if (!g) return;
      editor?.chain().focus().insertContent(`{{generation:${g.name}}}`).run();
      showToast('已插入代系卡片', 'success');
    } catch (e) {
      showToast(e.message || '插入代系失败', 'error');
    }
  };

  const insertTable = () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

  if (!editor) return null;

  const btn = (label, title, cmd, active) => (
    <button key={title} type="button" title={title} className={active ? 'active' : ''}
      onMouseDown={e => { e.preventDefault(); cmd(); }}>{label}</button>
  );
  // 分隔符必须是「每次调用生成新元素 + 稳定唯一的 key」：
  // 旧写法把同一个元素实例（key 每次渲染都取随机数）在工具栏里复用了 4 次，
  // key 每渲染都变 → React 每操作一次就追加一个新节点，于是 "|" 越点越多。
  const sep = (k) => <span className="sep" key={k} />;

  return (
    <div className="wiki-editor" ref={wrapRef} style={{ position: 'relative' }}>
      <div className="wiki-editor-toolbar">
        {btn(<b>B</b>, '加粗', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {btn(<i>I</i>, '斜体', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {btn(<s>S</s>, '删除线', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
        {btn('H1', '一级标题', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
        {btn('H2', '二级标题', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {btn('H3', '三级标题', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
        {sep('s1')}
        {btn('≡', '无序列表', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('1.', '有序列表', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {btn('☑', '任务清单', () => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList'))}
        {btn('❝', '引用', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
        {sep('s2')}
        {btn('</>', '代码块（高亮）', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
        {btn('▦', '插入表格', insertTable, editor.isActive('table'))}
        {editor.isActive('table') && (
          <>
            {btn('+行', '下方加一行', () => editor.chain().focus().addRowAfter().run())}
            {btn('+列', '右侧加一列', () => editor.chain().focus().addColumnAfter().run())}
            {btn('-行', '删除本行', () => editor.chain().focus().deleteRow().run())}
            {btn('-列', '删除本列', () => editor.chain().focus().deleteColumn().run())}
            {btn('删表', '删除表格', () => editor.chain().focus().deleteTable().run())}
          </>
        )}
        {sep('s3')}
        {btn(<IconLink />, '插入普通链接', () => {
          const prev = editor.getAttributes('link').href;
          const url = window.prompt('输入链接地址', prev || 'https://');
          if (url === null) return;
          if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }, editor.isActive('link'))}
        {btn(<IconWikiLink />, '插入 Wiki 内链 [[页面名]]', () => {
          const title = window.prompt('输入目标页面标题（不存在则显示为待创建红链）');
          if (title) editor.chain().focus().insertContent(`[[${title.trim()}]]`).run();
        })}
        {btn(<IconImage />, '插入图片（可多选）', () => fileRef.current?.click())}
        {btn('图注', '插入图注（说明文字）', () => editor.chain().focus().insertContent('<p class="wiki-caption">图注：</p>').run())}
        {btn(<IconMember />, '插入成员卡片 {{member:id}}', openMemberPicker)}
        {btn(<IconGeneration />, '插入代系卡片 {{generation:名称}}', insertGeneration)}
        {sep('s4')}
        {btn('—', '分割线', () => editor.chain().focus().setHorizontalRule().run(), false)}
        {btn(<IconUndo />, '撤销', () => editor.chain().focus().undo().run())}
        {btn(<IconRedo />, '重做', () => editor.chain().focus().redo().run())}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => { uploadAndInsert(Array.from(e.target.files || [])); e.target.value = ''; }}
      />

      {linkPopup && linkPopup.items.length > 0 && (
        <div className="wiki-link-popup" style={{ top: linkPopup.top, left: linkPopup.left }}>
          {linkPopup.items.map(p => (
            <div key={p.id} className="wlp-item" onMouseDown={e => { e.preventDefault(); insertWikiLink(p); }}>
              {p.title}<i>{p.category_name || '未分类'}</i>
            </div>
          ))}
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}
