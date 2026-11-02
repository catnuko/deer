import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "@/components/settings/SettingRow";
import {
  useAppSettings,
  type BookshelfSort,
  type StartupView,
} from "@/store/appSettings";

const STARTUP_LABELS: Record<StartupView, string> = {
  bookshelf: "书架",
  continue: "继续上次阅读",
};

const SORT_LABELS: Record<BookshelfSort, string> = {
  recent: "最近阅读",
  title: "书名",
  author: "作者",
  added: "导入时间",
};

export function GeneralSection() {
  const startupView = useAppSettings((state) => state.startupView);
  const bookshelfSort = useAppSettings((state) => state.bookshelfSort);
  const setStartupView = useAppSettings((state) => state.setStartupView);
  const setBookshelfSort = useAppSettings((state) => state.setBookshelfSort);

  return (
    <div className="max-w-xl">
      <SettingRow
        title="启动时打开"
        description="「继续上次阅读」会直接打开最近读过的书；没有阅读记录时仍落在书架。"
      >
        <Select
          items={STARTUP_LABELS}
          value={startupView}
          onValueChange={(value) => {
            if (value === "bookshelf" || value === "continue") {
              setStartupView(value);
            }
          }}
        >
          <SelectTrigger className="w-40" aria-label="启动时打开">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bookshelf">{STARTUP_LABELS.bookshelf}</SelectItem>
            <SelectItem value="continue">{STARTUP_LABELS.continue}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <Separator />

      <SettingRow
        title="书架默认排序"
        description="只影响展示顺序，不改动导入与存储顺序。"
      >
        <Select
          items={SORT_LABELS}
          value={bookshelfSort}
          onValueChange={(value) => {
            if (
              value === "recent" ||
              value === "title" ||
              value === "author" ||
              value === "added"
            ) {
              setBookshelfSort(value);
            }
          }}
        >
          <SelectTrigger className="w-40" aria-label="书架默认排序">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as BookshelfSort[]).map((value) => (
              <SelectItem key={value} value={value}>
                {SORT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </div>
  );
}