import { useState } from "react";
import { BookA } from "lucide-react";
import type { ChatDictionaryEntry, DictionarySense } from "@/lib/types";

/** 组件侧截断：默认全卡最多 2 个词性组、每组最多 2 条释义（设计稿 §3.4）。 */
const MAX_GROUPS = 2;
const MAX_SENSES_PER_GROUP = 2;

/** 连续同词性的释义归为一组，词性缺失的自成一组。 */
function groupSenses(senses: DictionarySense[]) {
  const groups: { partOfSpeech?: string; senses: DictionarySense[] }[] = [];
  for (const sense of senses) {
    const last = groups[groups.length - 1];
    if (last && last.partOfSpeech === sense.partOfSpeech) {
      last.senses.push(sense);
    } else {
      groups.push({ partOfSpeech: sense.partOfSpeech, senses: [sense] });
    }
  }
  return groups;
}

/** 单条释义：编号 + 正文，例句缺省不渲染。 */
function SenseLine({
  sense,
  index,
}: {
  sense: DictionarySense;
  index: number;
}) {
  return (
    <li className="mt-1 list-none">
      <p className="text-sm leading-relaxed">
        <span className="text-muted-foreground mr-1.5 tabular-nums">
          {index + 1}.
        </span>
        {sense.definition}
      </p>
      {sense.example && (
        <p className="text-muted-foreground mt-1 text-xs italic">
          {`— ${sense.example}`}
        </p>
      )}
    </li>
  );
}

/**
 * 聊天里的词典卡：lookup_dictionary 工具返回的词条，按词典卡设计稿实现。
 * 逐字段优雅降级（无音标/无例句/无释义不留空节点），长词 break-words 防撑爆。
 */
export function ChatDictionaryCard({ entry }: { entry: ChatDictionaryEntry }) {
  const [expanded, setExpanded] = useState(false);

  // 渲染前丢弃空释义；无词头、或释义与音标全缺时整卡不渲染（设计稿 §4.4）。
  const senses = (entry.senses ?? []).filter((s) => s.definition?.trim());
  const hasHead = !!entry.word.trim();
  if (!hasHead || (!senses.length && !entry.phonetic)) return null;

  const groups = groupSenses(senses);
  const visibleGroups = expanded
    ? groups
    : groups
        .slice(0, MAX_GROUPS)
        .map((g) => ({ ...g, senses: g.senses.slice(0, MAX_SENSES_PER_GROUP) }))
        .filter((g) => g.senses.length > 0);
  const hiddenCount =
    senses.length -
    visibleGroups.reduce((sum, g) => sum + g.senses.length, 0);

  return (
    <div
      data-testid="chat-dictionary-card"
      className="border-border bg-card mt-2 w-full rounded-xl border p-3"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-base leading-snug font-semibold break-words">
          {entry.word}
        </p>
        {entry.phonetic && (
          <p className="text-muted-foreground text-xs break-words">
            {entry.phonetic}
          </p>
        )}
      </div>

      {senses.length ? (
        visibleGroups.map((group, groupIndex) => (
          <div
            key={`${group.partOfSpeech ?? "plain"}-${groupIndex}`}
            className={groupIndex === 0 ? "" : "mt-3"}
          >
            {group.partOfSpeech && (
              <span className="bg-secondary text-secondary-foreground inline-block rounded-full px-2 py-0.5 text-[11px]">
                {group.partOfSpeech}
              </span>
            )}
            <ul>
              {group.senses.map((sense, index) => (
                <SenseLine key={index} sense={sense} index={index} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="text-muted-foreground mt-2 text-sm">词典源未返回释义</p>
      )}

      {(expanded || hiddenCount > 0) && (
        <button
          type="button"
          aria-expanded={expanded}
          className="text-muted-foreground hover:text-foreground mt-2 cursor-pointer text-xs transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起 ↑" : `展开全部 ${hiddenCount} 条释义 ↓`}
        </button>
      )}

      <p className="text-muted-foreground/70 mt-2.5 flex items-center gap-1 text-[11px]">
        <BookA className="size-3" />
        来自 dictionaryapi.dev
      </p>
    </div>
  );
}
