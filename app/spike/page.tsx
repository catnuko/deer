'use client';

import * as React from 'react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/src/components/ui/command';

const NOTES = [
  { id: 'n1', title: '关于注意力经济的读书笔记', group: '读书笔记' },
  { id: 'n2', title: 'Deer 纯 Web 架构决策记录', group: '项目记录' },
  { id: 'n3', title: '城市规划里的公共空间', group: '读书笔记' },
  { id: 'n4', title: 'shadcn base 变体接入成本清单', group: '项目记录' },
  { id: 'n5', title: '小说人物的动机结构', group: '读书笔记' },
];

export default function SpikePage() {
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string | null>(null);

  return (
    <main className="page">
      <h1 style={{ fontSize: '2.4rem' }}>shadcn base · Command spike</h1>
      <p className="lead">
        这是一个只用于技术验证的页面，不是正式功能页。它验证 shadcn base
        变体的 Command 组件能否在 Deer 的纯 CSS 主题上渲染、过滤与选中。
      </p>

      <p>
        当前选中：<strong data-testid="picked">{picked ?? '（无）'}</strong>
      </p>

      <button
        type="button"
        className="cta"
        onClick={() => setOpen(true)}
        style={{ marginBottom: '24px' }}
      >
        打开 Command 面板
      </button>

      {/* 内联 Command（不使用 Dialog），验证过滤与选中 */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.4rem' }}>内联 Command</h2>
        <div
          className="shadcn-scope"
          style={{
            width: '420px',
            maxWidth: '100%',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            overflow: 'hidden',
            marginTop: '12px',
          }}
        >
          <Command>
            <CommandInput placeholder="输入关键词过滤…" />
            <CommandList>
              <CommandEmpty>没有匹配的结果。</CommandEmpty>
              <CommandGroup heading="读书笔记">
                {NOTES.filter((n) => n.group === '读书笔记').map((note) => (
                  <CommandItem
                    key={note.id}
                    value={note.title}
                    onSelect={() => setPicked(note.title)}
                  >
                    {note.title}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="项目记录">
                {NOTES.filter((n) => n.group === '项目记录').map((note) => (
                  <CommandItem
                    key={note.id}
                    value={note.title}
                    onSelect={() => setPicked(note.title)}
                  >
                    {note.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </section>

      {/* CommandDialog：验证 base-ui Dialog + cmdk 的组合 */}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="命令面板"
        description="搜索笔记或命令"
        className="shadcn-scope"
      >
        <Command>
          <CommandInput placeholder="输入关键词过滤…" />
          <CommandList>
            <CommandEmpty>没有匹配的结果。</CommandEmpty>
            <CommandGroup heading="全部条目">
              {NOTES.map((note) => (
                <CommandItem
                  key={note.id}
                  value={note.title}
                  onSelect={() => {
                    setPicked(note.title);
                    setOpen(false);
                  }}
                >
                  {note.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </main>
  );
}
