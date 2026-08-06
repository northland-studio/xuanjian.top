import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

// Tiptap 富文本编辑器
export default function RichTextEditor({ value, onChange, placeholder, minHeight = 220 }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Placeholder.configure({ placeholder: placeholder || '请输入正文内容...' })
    ],
    content: value || '',
    onUpdate: ({ editor: ed }) => {
      if (onChange) onChange(ed.getHTML());
    },
    editorProps: {
      attributes: { class: 'rich-editor-content', style: `min-height: ${minHeight}px` }
    }
  });

  if (!editor) return null;

  const btn = (label, title, cmd, active) => (
    <button
      key={title}
      type="button"
      title={title}
      className={active ? 'active' : ''}
      onMouseDown={e => { e.preventDefault(); cmd(); }}
    >
      {label}
    </button>
  );

  const setLink = () => {
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('输入链接地址', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar">
        {btn(<b>B</b>, '加粗', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {btn(<i>I</i>, '斜体', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {btn(<s>S</s>, '删除线', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
        {btn('H1', '一级标题', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
        {btn('H2', '二级标题', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {btn('H3', '三级标题', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        {btn('≡', '无序列表', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn('1.', '有序列表', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {btn('❝', '引用', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        {btn('</>', '代码块', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
        {btn('链接', '插入链接', setLink, editor.isActive('link'))}
        {btn('—', '分割线', () => editor.chain().focus().setHorizontalRule().run(), false)}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
