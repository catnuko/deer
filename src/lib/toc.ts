/**
 * 目录推导：从阅读正文里切出章节。纯函数，不碰 DOM；阅读页按返回的
 * 分段渲染正文，抽屉的跳转目标是分段的 DOM 锚点。
 */

export interface TocSection {
  title: string;
  body: string;
}

/** 「第 X 章 / 第 X 节 / Chapter n / 一、二、」开头的段落视为章节标题。 */
const CHAPTER_RE = /^(第[一二三四五六七八九十百千0-9]+[章章节回]|[0-9]{1,3}[.、]\s*\S|Chapter\s+\d+)/i;
const MD_HEADING_RE = /^#{1,6}\s+(.*)$/;

function isChapterTitle(paragraph: string): boolean {
  const line = paragraph.trim();
  return line.length <= 40 && CHAPTER_RE.test(line);
}

/** 文本：按空行分段，章节标题段落开启新章；没有章节标题时归为「全文」。 */
export function deriveTocFromText(content: string): TocSection[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const sections: TocSection[] = [];
  let current: TocSection | null = null;

  for (const p of paragraphs) {
    if (isChapterTitle(p)) {
      if (current) sections.push(current);
      current = { title: p.replace(/\s+/g, ' '), body: '' };
      continue;
    }
    if (!current) current = { title: '开篇', body: '' };
    current.body += (current.body ? '\n\n' : '') + p;
  }
  if (current) sections.push(current);

  if (sections.length === 1 && sections[0].title === '开篇') {
    return [{ title: '全文', body: sections[0].body }];
  }
  return sections;
}

/** Markdown：按标题行分段，标题文本做目录项。 */
export function deriveTocFromMarkdown(content: string): TocSection[] {
  const lines = content.split(/\r?\n/);
  const sections: TocSection[] = [];
  let current: TocSection | null = null;

  for (const line of lines) {
    const heading = line.match(MD_HEADING_RE);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].trim() || '未命名章节', body: '' };
      continue;
    }
    if (!current) current = { title: '开篇', body: '' };
    current.body += (current.body ? '\n' : '') + line;
  }
  if (current) sections.push(current);

  if (sections.length === 1 && sections[0].title === '开篇') {
    return [{ title: '全文', body: sections[0].body }];
  }
  return sections;
}

export function deriveToc(content: string, contentType: 'text' | 'markdown'): TocSection[] {
  return contentType === 'markdown' ? deriveTocFromMarkdown(content) : deriveTocFromText(content);
}

/** 当前滚动位置对应的章节下标（段落锚点 offsetTop vs 滚动位置）。 */
export function currentSectionIndex(offsets: number[], scrollTop: number): number {
  let index = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i] <= scrollTop + 80) index = i;
  }
  return index;
}
