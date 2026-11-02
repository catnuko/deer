import {
  FONT_FAMILY_CSS,
  PAGE_MARGIN_PX,
  type FontFamily,
  type LineHeight,
  type PageMargin,
} from "@/store/readingSettings";
import type { DemoChapter } from "@/routes/reader/demoBook";

type ReaderArticleProps = {
  chapter: DemoChapter;
  fontSize: number;
  lineHeight: LineHeight;
  fontFamily: FontFamily;
  pageMargin: PageMargin;
};

/** 正文排版：字号/行距/字体/页边距跟随阅读设置（docs/design-handoff/tokens.md）。 */
export function ReaderArticle({
  chapter,
  fontSize,
  lineHeight,
  fontFamily,
  pageMargin,
}: ReaderArticleProps) {
  return (
    <article
      className="mx-auto w-full max-w-2xl py-10 font-serif"
      style={{
        paddingLeft: 32 + PAGE_MARGIN_PX[pageMargin],
        paddingRight: 32 + PAGE_MARGIN_PX[pageMargin],
      }}
    >
      <h2 className="mb-8 text-xl font-semibold tracking-tight">
        {chapter.title}
      </h2>
      <div
        style={{
          fontSize: `${fontSize}px`,
          lineHeight,
          fontFamily: FONT_FAMILY_CSS[fontFamily],
        }}
      >
        {chapter.paragraphs.map((paragraph, index) => (
          <p key={index} className="mb-[1.2em] indent-8 last:mb-0">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}