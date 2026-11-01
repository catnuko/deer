/**
 * 假回复：不联网、不调用任何模型。
 * 按用户问题里的关键词回一段写死的中文，用于验证会话隔离与持久化链路。
 */

const MOCK_DELAY_MS = 600;

export const MOCK_DELAY = MOCK_DELAY_MS;

const REPLIES: { match: RegExp; reply: string }[] = [
  {
    match: /主角|人物|谁/,
    reply:
      "（示例回复 · 未接模型）这本书的主角在不同章节里承担了不同的叙事功能。第一章里他只是一个观察者，到第三章才真正做出选择。",
  },
  {
    match: /主题|讲什么|讲了/,
    reply:
      "（示例回复 · 未接模型）粗看下来，全书围绕「留下还是离开」这条线展开，反复用同一个场景的变化来标记时间。",
  },
  {
    match: /结尾|结局|最后/,
    reply:
      "（示例回复 · 未接模型）我还没读到结尾。按目前的进度（第 3 章），更像是开放式收束，而不是一个明确的答案。",
  },
];

const DEFAULT_REPLY =
  "（示例回复 · 未接模型）我记下了你这个问题。当前面板还没有接入模型，所以这里只是一段占位文字；等接上之后再回来回答它。";

export function mockReply(userText: string): string {
  const text = userText.trim();
  for (const { match, reply } of REPLIES) {
    if (match.test(text)) return reply;
  }
  return DEFAULT_REPLY;
}