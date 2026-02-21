// 富文本编辑器实现
export class RichEditor {
    private container: HTMLElement;
    private editor!: HTMLElement;
    private textarea: HTMLTextAreaElement;
    private toolbar!: HTMLElement;

    constructor(containerId: string, initialContent: string = '') {
        const container = document.getElementById(containerId);
        if (!container) throw new Error(`Container #${containerId} not found`);
        
        this.container = container;
        this.textarea = document.createElement('textarea');
        this.textarea.id = containerId + '-content';
        this.textarea.style.display = 'none';
        
        this.render();
        this.setupEventListeners();
        
        if (initialContent) {
            this.setContent(initialContent);
        }
    }

    private render() {
        this.container.innerHTML = `
            <div class="rich-editor">
                <div class="rich-editor-toolbar">
                    <button type="button" data-command="bold" title="粗体">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
                        </svg>
                    </button>
                    <button type="button" data-command="italic" title="斜体">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>
                        </svg>
                    </button>
                    <button type="button" data-command="underline" title="下划线">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/>
                        </svg>
                    </button>
                    <span class="toolbar-separator"></span>
                    <button type="button" data-command="justifyLeft" title="左对齐">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z"/>
                        </svg>
                    </button>
                    <button type="button" data-command="justifyCenter" title="居中">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z"/>
                        </svg>
                    </button>
                    <button type="button" data-command="justifyRight" title="右对齐">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z"/>
                        </svg>
                    </button>
                    <span class="toolbar-separator"></span>
                    <button type="button" data-command="insertUnorderedList" title="无序列表">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
                        </svg>
                    </button>
                    <button type="button" data-command="insertOrderedList" title="有序列表">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
                        </svg>
                    </button>
                    <span class="toolbar-separator"></span>
                    <button type="button" data-command="createLink" title="插入链接">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                        </svg>
                    </button>
                    <button type="button" data-command="insertImage" title="插入图片">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                        </svg>
                    </button>
                    <span class="toolbar-separator"></span>
                    <button type="button" data-command="removeFormat" title="清除格式">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z"/>
                        </svg>
                    </button>
                </div>
                <div class="rich-editor-content" contenteditable="true"></div>
            </div>
        `;
        
        this.editor = this.container.querySelector('.rich-editor-content') as HTMLElement;
        this.toolbar = this.container.querySelector('.rich-editor-toolbar') as HTMLElement;
        this.container.appendChild(this.textarea);
    }

    private setupEventListeners() {
        // 工具栏按钮点击事件
        this.toolbar.querySelectorAll('button[data-command]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const command = (btn as HTMLElement).dataset.command;
                if (command) {
                    this.execCommand(command);
                }
            });
        });

        // 编辑器内容变化时同步到textarea
        this.editor.addEventListener('input', () => {
            this.syncToTextarea();
        });

        // 防止粘贴时带入样式
        this.editor.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData?.getData('text/plain') || '';
            document.execCommand('insertText', false, text);
        });
    }

    private execCommand(command: string, value: string = '') {
        this.editor.focus();
        
        if (command === 'createLink') {
            const url = prompt('请输入链接地址:', 'https://');
            if (url) {
                document.execCommand(command, false, url);
            }
        } else if (command === 'insertImage') {
            const url = prompt('请输入图片地址:', 'https://');
            if (url) {
                document.execCommand(command, false, url);
            }
        } else {
            document.execCommand(command, false, value);
        }
        
        this.syncToTextarea();
    }

    private syncToTextarea() {
        this.textarea.value = this.editor.innerHTML;
    }

    public getContent(): string {
        return this.editor.innerHTML;
    }

    public getTextContent(): string {
        return this.editor.textContent || '';
    }

    public setContent(html: string) {
        this.editor.innerHTML = html;
        this.syncToTextarea();
    }

    public clear() {
        this.editor.innerHTML = '';
        this.syncToTextarea();
    }

    public focus() {
        this.editor.focus();
    }

    public destroy() {
        this.container.innerHTML = '';
    }
}

// 简单的HTML转纯文本（用于摘要）
export function stripHtml(html: string): string {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}
