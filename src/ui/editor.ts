/**
 * TMD 编辑器管理
 * 
 * 封装 textarea 的交互逻辑：
 * - 内容读写
 * - 变更事件（防抖）
 * - 加载 demo 数据
 * - 后续可替换为 Monaco Editor
 */

export interface EditorOptions {
  /** textarea 元素 */
  element: HTMLTextAreaElement;
  /** 内容变更回调（已防抖） */
  onChange?: (content: string) => void;
  /** 防抖延迟（ms） */
  debounceMs?: number;
}

export class TmdEditor {
  private el: HTMLTextAreaElement;
  private onChange: ((content: string) => void) | null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;

  constructor(options: EditorOptions) {
    this.el = options.element;
    this.onChange = options.onChange ?? null;
    this.debounceMs = options.debounceMs ?? 500;

    this.el.addEventListener('input', this.handleInput.bind(this));
  }

  /** 获取当前内容 */
  getContent(): string {
    return this.el.value;
  }

  /** 设置内容 */
  setContent(text: string): void {
    this.el.value = text;
  }

  /** 加载 demo 文件 */
  async loadDemo(url: string): Promise<void> {
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      this.setContent(text);
      // 触发一次变更
      this.onChange?.(text);
    } catch (e) {
      console.error('加载 demo 失败:', e);
    }
  }

  /** 销毁 */
  destroy(): void {
    this.el.removeEventListener('input', this.handleInput.bind(this));
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private handleInput(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.onChange?.(this.getContent());
    }, this.debounceMs);
  }
}
