import { describe, expect, it } from 'vitest';
import { formatSessionTime, fullSessionSummary, fullSessionTime, undoButtonLabel, sessionSummary } from '@/src/lib/session-display';
import { formatSelectionPrompt } from '@/src/lib/chat-context';
import type { StoredChatMessage } from '@/src/lib/chat-storage';

const MINUTE = 60_000;
const HOUR = 3_600_000;

function dialogue(): StoredChatMessage[] {
  return [
    { id: '1', role: 'user', content: '第一段问题' },
    { id: '2', role: 'assistant', content: '第一段回答' },
  ];
}

describe('session-display - sessionSummary', () => {
  it('AC2: summarises the first user message, ignoring assistant turns', () => {
    expect(sessionSummary(dialogue())).toBe('第一段问题');
  });

  it('AC2: strips the selection prompt prefix and its surrounding quotes', () => {
    const messages: StoredChatMessage[] = [
      { id: '1', role: 'user', content: formatSelectionPrompt('需要解释的句子') },
    ];
    expect(sessionSummary(messages)).toBe('需要解释的句子');
  });

  it('AC2: collapses newlines and repeated whitespace into single spaces', () => {
    const messages: StoredChatMessage[] = [
      { id: '1', role: 'user', content: '第一段\n\n   讲时间\t第二段落' },
    ];
    expect(sessionSummary(messages)).toBe('第一段 讲时间 第二段落');
  });

  it('AC2: truncates at 20 characters with an ellipsis marker', () => {
    const long = '这是一段很长很长的中文内容，用来验证摘要在二十个字符处截断的行为。';
    const summary = sessionSummary([{ id: '1', role: 'user', content: long }]);
    expect(summary).toBe(`${long.slice(0, 20)}…`);
    expect(summary).toHaveLength(21);
  });

  it('AC2: keeps a message of exactly twenty characters without an ellipsis', () => {
    const exact = '一'.repeat(20);
    expect(sessionSummary([{ id: '1', role: 'user', content: exact }])).toBe(exact);
  });

  it('AC2: shows the placeholder when stripping leaves nothing behind', () => {
    expect(sessionSummary([{ id: '1', role: 'user', content: formatSelectionPrompt('') }])).toBe('（未命名会话）');
    expect(sessionSummary([])).toBe('（未命名会话）');
  });

  it('AC2: tolerates blank and whitespace-only conversations', () => {
    expect(sessionSummary([{ id: '1', role: 'user', content: '   \n  ' }])).toBe('（未命名会话）');
  });

  it('keeps the complete first message for title and aria-label', () => {
    const full = '第一段\n\n讲时间与记忆的问题';
    const messages: StoredChatMessage[] = [{ id: '1', role: 'user', content: full }];
    expect(sessionSummary(messages)).toContain('第一段 讲时间与记忆的问题');
    expect(fullSessionSummary(messages)).not.toContain('\n');
  });
});

describe('session-display - formatSessionTime', () => {
  const now = new Date('2026-10-25T15:30:00').getTime();

  it('AC2: under a minute reads as just now', () => {
    expect(formatSessionTime(now - 59_000, now)).toBe('刚刚');
    expect(formatSessionTime(now, now)).toBe('刚刚');
  });

  it('AC2: under an hour reads as N minutes ago', () => {
    expect(formatSessionTime(now - 59 * MINUTE, now)).toBe('59 分钟前');
    expect(formatSessionTime(now - 2 * MINUTE, now)).toBe('2 分钟前');
  });

  it('AC2: under a day reads as N hours ago', () => {
    expect(formatSessionTime(now - 23 * HOUR, now)).toBe('23 小时前');
    expect(formatSessionTime(now - 2 * HOUR, now)).toBe('2 小时前');
  });

  it('AC2: the previous calendar day reads as yesterday with a clock time', () => {
    // Past the relative-hours window, so the calendar day decides the label.
    const yesterday = new Date('2026-10-24T14:05:00').getTime();
    expect(formatSessionTime(yesterday, now)).toBe('昨天 14:05');
  });

  it('AC2: an older day in the same year reads as month and day', () => {
    expect(formatSessionTime(new Date('2026-10-01T09:00:00').getTime(), now)).toBe('10月1日');
    expect(formatSessionTime(new Date('2026-01-05T09:00:00').getTime(), now)).toBe('1月5日');
  });

  it('AC2: a day in another year reads as year, month and day', () => {
    expect(formatSessionTime(new Date('2025-12-31T23:00:00').getTime(), now)).toBe('2025/12/31');
  });

  it('AC2: a future timestamp never produces a negative count', () => {
    expect(formatSessionTime(now + 10 * MINUTE, now)).toBe('刚刚');
  });

  it('exposes the full local time for title and datetime attributes', () => {
    const ts = new Date('2026-10-24T20:05:00').getTime();
    expect(fullSessionTime(ts)).toBe(new Date(ts).toLocaleString());
  });
});

describe('session-display - undoButtonLabel', () => {
  it('labels the undo button with the cleared session summary', () => {
    const messages: StoredChatMessage[] = [{ id: '1', role: 'user', content: '误清的问题' }];
    expect(undoButtonLabel(messages)).toBe('↩️ 撤销恢复「误清的问题」');
  });

  it('AC5: never announces a count or a second chance', () => {
    const label = undoButtonLabel(dialogue());
    expect(label).not.toContain('次');
    expect(label).not.toContain('1');
  });

  it('uses the placeholder when the cleared summary is empty', () => {
    expect(undoButtonLabel([])).toBe('↩️ 撤销恢复「（未命名会话）」');
  });
});
