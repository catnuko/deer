/**
 * 书架的演示数据与纯函数。Deer 目前没有书籍持久化存储（阅读正文走
 * sessionStorage，见 reading.ts），因此书目数据是可演示的种子，仅在
 * 会话内存中增删，不引入新的存储契约。导入真实文件仍走 page 上既有的
 * sessionStorage 写入逻辑。
 */

export interface Book {
  id: string;
  title: string;
  author: string;
  /** 0–100，0 表示未开始，100 表示已读完。 */
  progress: number;
  /** 距上次阅读的小时数；null 表示从未读过（未读）。 */
  lastReadHoursAgo: number | null;
}

/** 演示种子（对应设计板 02-home-bookshelf 的书目）。 */
export const SEED_BOOKS: Book[] = [
  { id: 'seed-santi', title: '三体', author: '刘慈欣', progress: 68, lastReadHoursAgo: 2 },
  { id: 'seed-renleijianshi', title: '人类简史', author: '尤瓦尔·赫拉利', progress: 32, lastReadHoursAgo: 26 },
  { id: 'seed-sikaokuaiyuman', title: '思考，快与慢', author: '丹尼尔·卡尼曼', progress: 12, lastReadHoursAgo: 74 },
  { id: 'seed-huozhe', title: '活着', author: '余华', progress: 100, lastReadHoursAgo: 240 },
  { id: 'seed-hongloumeng', title: '红楼梦', author: '曹雪芹', progress: 0, lastReadHoursAgo: null },
  { id: 'seed-xiaowangzi', title: '小王子', author: '圣埃克苏佩里', progress: 45, lastReadHoursAgo: 168 },
  { id: 'seed-jijin', title: '基金投资入门', author: '老罗', progress: 8, lastReadHoursAgo: 336 },
  { id: 'seed-yewande', title: '夜晚的潜水艇', author: '陈春成', progress: 76, lastReadHoursAgo: 400 },
];

export function isUnread(book: Book): boolean {
  return book.lastReadHoursAgo === null;
}

export function isFinished(book: Book): boolean {
  return book.progress >= 100;
}

export function isInProgress(book: Book): boolean {
  return book.progress > 0 && book.progress < 100;
}

/** 「继续阅读」区：进行中的书按最近阅读排序。 */
export function pickContinueReading(books: Book[]): Book[] {
  return books
    .filter(isInProgress)
    .sort((a, b) => (a.lastReadHoursAgo ?? Infinity) - (b.lastReadHoursAgo ?? Infinity))
    .slice(0, 4);
}

export type ShelfSort = 'recent' | 'added' | 'title';

/** 全部书籍排序：最近阅读 / 添加时间（种子序即添加序）/ 书名。 */
export function sortBooks(books: Book[], sort: ShelfSort): Book[] {
  const copy = [...books];
  if (sort === 'recent') {
    return copy.sort((a, b) => (a.lastReadHoursAgo ?? Infinity) - (b.lastReadHoursAgo ?? Infinity));
  }
  if (sort === 'title') {
    return copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  }
  return copy;
}

/** 搜索过滤：匹配书名或作者，大小写不敏感。 */
export function filterBooks(books: Book[], query: string): Book[] {
  const q = query.trim().toLowerCase();
  if (!q) return books;
  return books.filter(
    (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q),
  );
}

/** 相对时间文案：卡片 meta 用。 */
export function formatRelativeTime(hoursAgo: number | null): string {
  if (hoursAgo === null) return '未读';
  if (hoursAgo < 1) return '刚刚';
  if (hoursAgo < 24) return `${Math.round(hoursAgo)} 小时前`;
  const days = Math.round(hoursAgo / 24);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const months = Math.round(days / 30);
  return `${months} 个月前`;
}

/** 进度文案：0 显示「未开始」，其余显示百分比。 */
export function formatProgress(progress: number): string {
  if (progress <= 0) return '未开始';
  return `${progress}%`;
}

/** 封面占位字：书名首字。 */
export function coverInitial(title: string): string {
  const first = title.trim().charAt(0);
  return first || '书';
}

/**
 * 种子书没有真实文件，打开时生成可演示的章节化正文，走既有的
 * sessionStorage 阅读契约（READING_* 键）写入，供阅读页外壳演示。
 */
export function demoContentFor(book: Book): string {
  const chapters = ['雾中信号', '低语', '回声', '长夜', '黎明前'];
  const paragraphs = [
    '窗外的雨下了一整夜，屋檐上的水声像某种缓慢的钟摆，把时间切成长短相近的片段。她坐在桌前，把那封信读了第三遍，仍然没能从字里行间找出写信人真正想说的话。',
    '有些话一旦写下来，就不再是原来的意思了。纸页安静地承受着一切，也隐藏着一切。她想起很多年前同样一个落雨的傍晚，那时她还相信所有的谜题都有答案。',
    '如果记忆是一条河流，那么遗忘大概就是河床。水会流走，河床还在。他沿着河床往上游走，走过一块又一块光滑的石头，试图找到第一个把水搅浑的人。',
    '门口的灯忽然亮了。这不是定时的时间，也不是邻居的习惯。他放下手里的书，屏住呼吸听了一会儿——走廊里只有灰尘落地的声音，以及他自己逐渐加速的心跳。',
    '黎明前的黑暗并不是比喻，而是一种可以触摸的质地。它压在眼皮上，压在未完成的句子上，也压在所有等待天亮的人的肩膀上。而天总会亮的，这一点从未失信。',
  ];
  const lines: string[] = [`《${book.title}》`, ''];
  chapters.forEach((name, i) => {
    lines.push(`第 ${i + 1} 章 ${name}`, '');
    lines.push(paragraphs[i % paragraphs.length], '');
    lines.push(paragraphs[(i + 2) % paragraphs.length], '');
  });
  return lines.join('\n');
}
