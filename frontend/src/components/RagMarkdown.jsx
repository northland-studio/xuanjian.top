/**
 * 轻量 Markdown 渲染（零依赖、不使用 innerHTML）
 *
 * 输出的是 React 元素，模型给的内容一律作为文本书写，天然不会执行脚本/HTML。
 * 支持：标题(#~####)、无序/有序列表、引用、代码块、行内代码、粗体、斜体、链接、分隔线、段落。
 * 刻意不支持 HTML 标签与表格（提示词也要求模型不要输出表格）。
 */
import { Fragment } from 'react';

/** 行内解析：**粗体**、*斜体*、`代码`、[文字](链接) */
function renderInline(text) {
    const nodes = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\))/g;
    let last = 0;
    let m;
    let key = 0;
    while ((m = pattern.exec(text))) {
        if (m.index > last) nodes.push(text.slice(last, m.index));
        const token = m[0];
        if (token.startsWith('**')) {
            nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
        } else if (token.startsWith('`')) {
            nodes.push(
                <code key={key++} className="rag-md-code">
                    {token.slice(1, -1)}
                </code>
            );
        } else if (token.startsWith('[')) {
            const label = token.slice(1, token.indexOf(']'));
            const href = token.slice(token.indexOf('](') + 2, -1);
            nodes.push(
                <a key={key++} className="rag-md-link" href={href} target="_blank" rel="noopener noreferrer">
                    {label}
                </a>
            );
        } else {
            nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
        }
        last = m.index + token.length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

/** 块级解析 */
export default function RagMarkdown({ text }) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
        const line = lines[i];

        // 代码块
        if (/^\s*```/.test(line)) {
            const body = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
            i++;
            blocks.push(
                <pre key={key++} className="rag-md-pre">
                    <code>{body.join('\n')}</code>
                </pre>
            );
            continue;
        }

        if (!line.trim()) {
            i++;
            continue;
        }

        // 标题
        const h = /^(#{1,4})\s+(.*)$/.exec(line);
        if (h) {
            const level = h[1].length;
            const Tag = 'h' + Math.min(6, level + 2); // 浮窗内标题整体降级，避免比面板标题还大
            blocks.push(
                <Tag key={key++} className="rag-md-h">
                    {renderInline(h[2])}
                </Tag>
            );
            i++;
            continue;
        }

        // 分隔线
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
            blocks.push(<hr key={key++} className="rag-md-hr" />);
            i++;
            continue;
        }

        // 引用
        if (/^\s*>\s?/.test(line)) {
            const body = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                body.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            blocks.push(
                <blockquote key={key++} className="rag-md-quote">
                    {renderInline(body.join(' '))}
                </blockquote>
            );
            continue;
        }

        // 列表（无序 / 有序，支持简单缩进）
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
            const ordered = /^\s*\d+\.\s+/.test(line);
            const items = [];
            while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
                i++;
            }
            const ListTag = ordered ? 'ol' : 'ul';
            blocks.push(
                <ListTag key={key++} className="rag-md-list">
                    {items.map((it, idx) => (
                        <li key={idx}>{renderInline(it)}</li>
                    ))}
                </ListTag>
            );
            continue;
        }

        // 段落：合并到空行或下一个块级标记
        const para = [];
        while (
            i < lines.length &&
            lines[i].trim() &&
            !/^\s*```/.test(lines[i]) &&
            !/^(#{1,4})\s+/.test(lines[i]) &&
            !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
            !/^\s*>\s?/.test(lines[i]) &&
            !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])
        ) {
            para.push(lines[i]);
            i++;
        }
        blocks.push(
            <p key={key++} className="rag-md-p">
                {para.map((l, idx) => (
                    <Fragment key={idx}>
                        {idx > 0 && <br />}
                        {renderInline(l)}
                    </Fragment>
                ))}
            </p>
        );
    }

    return <div className="rag-md">{blocks}</div>;
}
