import { useState } from "react";
import { Languages } from "lucide-react";
import type { ChatTranslationEntry } from "@/lib/types";

/** 原文超过该长度时折叠为 6 行，展开/收起切换。 */
const SOURCE_CLAMP_THRESHOLD = 280;
/** 截断提示里的上限数字（与 deerTools 的 MAX_TRANSLATION_CHARS 对应）。 */
const TRUNCATED_CHARS = 2000;

/** 一段对照：语言 chip（缺省不渲染）+ 正文，超长折叠。 */
function Side({
  label,
  lang,
  text,
  clampable,
  expanded,
}: {
  label: string;
  lang?: string;
  text: string;
  clampable?: boolean;
  expanded?: boolean;
}) {
  const clamp = clampable && !expanded;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-[11px] tracking-wide">
          {label}
        </span>
        {lang && (
          <span className="bg-secondary text-secondary-foreground inline-block rounded-full px-2 py-0.5 text-[11px]">
            {lang}
          </span>
        )}
      </div>
      <p
        className={`mt-1 text-sm leading-relaxed break-words ${clamp ? "line-clamp-6" : ""}`}
      >
        {text}
      </p>
    </div>
  );
}

/**
 * 聊天里的翻译卡：translate_text 工具承载的原文/译文对照。
 * 源语言/目标语言检测失败时逐字段省略不报错；原文超长（>2000 字符被
 * 工具截断）给提示；长原文默认折叠 6 行，可展开。
 */
export function ChatTranslationCard({
  entry,
}: {
  entry: ChatTranslationEntry;
}) {
  const [expanded, setExpanded] = useState(false);

  // 原文与译文全缺时整卡不渲染（坏帧不该出现，防一手）。
  if (!entry.sourceText?.trim() && !entry.translatedText?.trim()) return null;

  const clampable = entry.sourceText.length > SOURCE_CLAMP_THRESHOLD;

  return (
    <div
      data-testid="chat-translation-card"
      className="border-border bg-card mt-2 w-full rounded-xl border p-3"
    >
      {entry.sourceText && (
        <Side
          label="原文"
          lang={entry.sourceLang}
          text={entry.sourceText}
          clampable={clampable}
          expanded={expanded}
        />
      )}

      {entry.sourceText && entry.translatedText && (
        <hr className="border-border my-2.5" />
      )}

      {entry.translatedText && (
        <Side label="译文" lang={entry.targetLang} text={entry.translatedText} />
      )}

      {entry.truncated && (
        <p className="text-muted-foreground mt-2 text-xs">
          {`原文超过 ${TRUNCATED_CHARS} 字符，仅展示并翻译前 ${TRUNCATED_CHARS} 字。`}
        </p>
      )}

      {clampable && (
        <button
          type="button"
          aria-expanded={expanded}
          className="text-muted-foreground hover:text-foreground mt-2 cursor-pointer text-xs transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起 ↑" : "展开全部原文 ↓"}
        </button>
      )}

      <p className="text-muted-foreground/70 mt-2.5 flex items-center gap-1 text-[11px]">
        <Languages className="size-3" />
        AI 翻译
      </p>
    </div>
  );
}
