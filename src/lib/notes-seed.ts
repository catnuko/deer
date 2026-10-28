import type { StoredNote } from './notes';

/**
 * In-memory demo notes for the empty notes page. The seed never touches
 * `deer-notes` storage — it exists only so the page can be demonstrated and
 * screenshotted before the reader flow has captured real notes. The shape is
 * exactly `StoredNote`, and the `ai:` prefix on one sourceContentId is the
 * same convention the view layer uses to mark an AI-问答 note.
 */
export function createSeedNotes(now: number = Date.now()): StoredNote[] {
  const hour = 3_600_000;
  const day = 24 * hour;
  return [
    {
      id: 'seed-unchanged-space',
      title: '宇宙就是一座时空的坟墓',
      excerpt: '宇宙就是一座时空的坟墓，静静地等待着每一个生命的到来……',
      excerptTruncated: false,
      understanding: '这是全书宇宙社会学的基石，与后文"黑暗森林"呼应。',
      sourceContentId: 'seed-1',
      sourceLabel: '《三体》· 第 3 章',
      createdAt: now - 2 * hour,
      updatedAt: now - 2 * hour,
      links: [],
    },
    {
      id: 'seed-axioms-of-civilization',
      title: '生存是文明的第一需要',
      excerpt:
        '生存是文明的第一需要。文明不断增长和扩张，但宇宙中的物质总量保持不变。',
      excerptTruncated: false,
      understanding: '两条公理 + 猜疑链 = 黑暗森林。',
      sourceContentId: 'ai:seed-2',
      sourceLabel: '《三体》· 第 12 章',
      createdAt: now - 26 * hour,
      updatedAt: now - 26 * hour,
      links: [],
    },
    {
      id: 'seed-weakness-and-ignorance',
      title: '弱小和无知不是生存的障碍',
      excerpt: '弱小和无知不是生存的障碍，傲慢才是。',
      excerptTruncated: false,
      understanding: '',
      sourceContentId: 'seed-3',
      sourceLabel: '《三体》· 第 22 章',
      createdAt: now - 3 * day,
      updatedAt: now - 3 * day,
      links: [],
    },
    {
      id: 'seed-carve-in-stone',
      title: '把字刻在石头上',
      excerpt: '把字刻在石头上。',
      excerptTruncated: false,
      understanding: '最古老也最持久的信息保存方式。',
      sourceContentId: 'seed-4',
      sourceLabel: '《三体》· 第 30 章',
      createdAt: now - 8 * day,
      updatedAt: now - 8 * day,
      links: [],
    },
  ];
}
