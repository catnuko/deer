import type { LineHeight } from "@/store/readingSettings";
import type { DemoChapter } from "@/routes/reader/demoBook";

type ReaderArticleProps = {
  chapter: DemoChapter;
  fontSize: number;
  lineHeight: LineHeight;
};

/** 正文排版：serif、字号/行距跟随阅读设置（docs/design-handoff/tokens.md）。 */
export function ReaderArticle({
  chapter,
  fontSize,
  lineHeight,
}: ReaderArticleProps) {
  return (
    <article className="mx-auto w-full max-w-2xl px-8 py-10 font-serif">
      <h2 className="mb-8 text-xl font-semibold tracking-tight">
        {chapter.title}
      </h2>
      <div style={{ fontSize: `${fontSize}px`, lineHeight }}>
        {chapter.paragraphs.map((paragraph, index) => (
          <p key={index} className="mb-[1.2em] indent-8 last:mb-0">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
