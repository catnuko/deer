'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  XIcon,
} from 'lucide-react';
import {
  type AIModelConfig,
  type ModelProvider,
  getStoredConfig,
  setStoredConfig,
  getDefaultConfig,
  validateBaseUrl,
  testConnection,
} from '@/src/lib/ai-config';
import {
  type ThemePreference,
  getStoredThemePreference,
  setStoredThemePreference,
  applyThemePreference,
} from '@/src/lib/theme';
import {
  type ReadingPrefs,
  DEFAULT_READING_PREFS,
  getReadingPrefs,
  saveReadingPrefs,
  READING_PREFS_LIMITS,
} from '@/src/lib/reading-prefs';
import { NOTES_STORAGE_KEY, listNotes } from '@/src/lib/notes';
import { SESSIONS_STORAGE_KEY } from '@/src/lib/chat-storage';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'reading' | 'ai' | 'data';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'reading', label: '阅读偏好' },
  { id: 'ai', label: 'AI' },
  { id: 'data', label: '数据' },
];

const ANSWER_LANGUAGE_KEY = 'deer-answer-language';
const ANSWER_LANGUAGES = ['跟随提问', '简体中文'] as const;

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function storageBytes(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return 0;
    return new Blob([raw]).size;
  } catch {
    return 0;
  }
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('ai');
  const [config, setConfig] = useState<AIModelConfig>(() => {
    const stored = getStoredConfig();
    return stored || getDefaultConfig('openai');
  });
  const [themePreference, setThemePreference] = useState<ThemePreference>('light');
  const [prefs, setPrefs] = useState<ReadingPrefs>({ ...DEFAULT_READING_PREFS });
  const [answerLanguage, setAnswerLanguage] = useState<string>(ANSWER_LANGUAGES[0]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; ms?: number } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [notesBytes, setNotesBytes] = useState(0);
  const [sessionsBytes, setSessionsBytes] = useState(0);
  const [exportError, setExportError] = useState('');

  // The AI config is saved the moment it changes (即时生效，无保存按钮), but
  // only after the reader touched it: the first render must not turn the
  // environment default into a user config.
  const configDirtyRef = useRef(false);

  // Every open re-reads the stores, so changes made elsewhere (another tab,
  // the ⌘K palette) are already on screen. The re-read happens during the
  // render that turns the panel visible — the pattern React documents for
  // "state that must reset when a prop changes", which keeps the cascading
  // setState of an effect out of the picture.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setThemePreference(getStoredThemePreference());
    setPrefs(getReadingPrefs());
    try {
      const storedLanguage = window.localStorage.getItem(ANSWER_LANGUAGE_KEY);
      if (storedLanguage && (ANSWER_LANGUAGES as readonly string[]).includes(storedLanguage)) {
        setAnswerLanguage(storedLanguage);
      }
    } catch {
      // Storage disabled: keep the default answer language.
    }
    setNotesBytes(storageBytes(NOTES_STORAGE_KEY));
    setSessionsBytes(storageBytes(SESSIONS_STORAGE_KEY));
  }

  // Esc closes the panel, the same way the ⌘K palette closes.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose]);

  function updateConfig(next: AIModelConfig) {
    configDirtyRef.current = true;
    setConfig(next);
    setStoredConfig(next);
  }

  function handleProviderChange(provider: ModelProvider) {
    const defaults = getDefaultConfig(provider);
    setTestResult(null);
    updateConfig({ ...defaults, apiKey: config.apiKey });
  }

  function handleThemeChange(preference: ThemePreference) {
    setThemePreference(preference);
    setStoredThemePreference(preference);
    applyThemePreference(preference);
  }

  function updatePrefs(next: ReadingPrefs) {
    setPrefs(next);
    saveReadingPrefs(next);
  }

  function updateAnswerLanguage(language: string) {
    setAnswerLanguage(language);
    try {
      window.localStorage.setItem(ANSWER_LANGUAGE_KEY, language);
    } catch {
      // Storage disabled: the choice lives only on screen.
    }
  }

  async function handleTestConnection() {
    if (config.provider === 'custom' && config.baseUrl && !validateBaseUrl(config.baseUrl)) {
      setTestResult({ success: false, message: 'API Base URL 格式不正确，需以 http:// 或 https:// 开头' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    const startedAt = Date.now();
    const result = await testConnection(config);
    setTestResult({ ...result, ms: Date.now() - startedAt });
    setIsTesting(false);
  }

  function handleExportNotes() {
    setExportError('');
    const notes = listNotes();
    if (notes.length === 0) {
      setExportError('还没有可导出的笔记');
      return;
    }
    const markdown = notes
      .map((note) => {
        const updated = new Date(note.updatedAt).toLocaleDateString('zh-CN');
        const source = note.sourceLabel || '未命名来源';
        return `# ${note.title}\n\n> ${note.excerpt}\n\n${note.understanding}\n\n—— 来源：${source} · 更新于 ${updated}\n`;
      })
      .join('\n---\n\n');
    try {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `deer-notes-${new Date().toISOString().slice(0, 10)}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('导出失败，请重试');
    }
  }

  if (!isOpen) return null;

  const baseUrlInvalid =
    config.provider === 'custom' &&
    config.baseUrl !== undefined &&
    config.baseUrl !== '' &&
    !validateBaseUrl(config.baseUrl);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#292524]/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[880px] flex-col overflow-hidden rounded-[var(--radius-overlay)] bg-[var(--surface)] shadow-[0_8px_32px_rgba(0,0,0,0.2)] sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧 tabs */}
        <div className="flex shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-[var(--sand)] p-4 sm:w-[200px] sm:flex-col sm:items-stretch sm:justify-start sm:border-b-0 sm:border-r">
          <div className="mr-auto flex items-center gap-2 sm:mb-4 sm:mr-0">
            <h2 className="text-lg font-semibold text-[var(--text)]">设置</h2>
          </div>
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`relative shrink-0 rounded-[var(--radius-control)] px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[var(--hover-bg)] font-medium text-[var(--text)]'
                    : 'text-[var(--text-2)] hover:bg-[var(--hover-bg)] hover:text-[var(--text)]'
                }`}
              >
                {active && (
                  <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--primary)] sm:block" />
                )}
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置面板"
            className="ml-auto rounded-[var(--radius-control)] p-2 text-[var(--text-2)] hover:bg-[var(--hover-bg)] sm:hidden"
          >
            <XIcon className="size-4" />
          </button>
          <p className="mt-auto hidden px-3 pt-6 text-xs text-[var(--text-2)] sm:block">
            改动即时生效，无需保存
          </p>
        </div>

        {/* 右侧内容区 */}
        <div className="relative flex-1 overflow-y-auto p-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置面板"
            className="absolute top-4 right-4 rounded-[var(--radius-control)] p-2 text-[var(--text-2)] hover:bg-[var(--hover-bg)]"
          >
            <XIcon className="size-4" />
          </button>

          {tab === 'general' && (
            <div className="space-y-6">
              <Row label="主题" description="浅色 / 深色 / 跟随系统">
                <div className="flex rounded-[var(--radius-control)] bg-[var(--hover-bg)] p-1">
                  {THEME_OPTIONS.map(({ value, label }) => {
                    const selected = themePreference === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleThemeChange(value)}
                        className={`rounded-[6px] px-4 py-1.5 text-sm transition-shadow ${
                          selected
                            ? 'bg-white font-medium text-[var(--text)] shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-[var(--sand)]'
                            : 'text-[var(--text-2)] hover:text-[var(--text)]'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Row>
              <Row label="语言" description="界面语言，更多语言即将支持">
                <select
                  disabled
                  value="简体中文"
                  className="h-10 w-56 rounded-[var(--radius-control)] border border-[var(--sand)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] opacity-60"
                >
                  <option value="简体中文">简体中文</option>
                </select>
              </Row>
            </div>
          )}

          {tab === 'reading' && (
            <div className="space-y-8">
              <SliderRow
                label="默认字号"
                description="正文文字的大小"
                min={READING_PREFS_LIMITS.fontSize.min}
                max={READING_PREFS_LIMITS.fontSize.max}
                step={READING_PREFS_LIMITS.fontSize.step}
                value={prefs.fontSize}
                display={`${prefs.fontSize}px`}
                onChange={(fontSize) => updatePrefs({ ...prefs, fontSize })}
              />
              <SliderRow
                label="行距"
                description="正文行与行之间的距离"
                min={READING_PREFS_LIMITS.lineHeight.min}
                max={READING_PREFS_LIMITS.lineHeight.max}
                step={READING_PREFS_LIMITS.lineHeight.step}
                value={prefs.lineHeight}
                display={prefs.lineHeight.toFixed(1)}
                onChange={(lineHeight) => updatePrefs({ ...prefs, lineHeight })}
              />
              <SliderRow
                label="页宽"
                description="阅读栏的宽度"
                min={READING_PREFS_LIMITS.pageWidth.min}
                max={READING_PREFS_LIMITS.pageWidth.max}
                step={READING_PREFS_LIMITS.pageWidth.step}
                value={prefs.pageWidth}
                display={`${prefs.pageWidth}px`}
                onChange={(pageWidth) => updatePrefs({ ...prefs, pageWidth })}
              />
              <p className="text-xs text-[var(--text-2)]">
                与阅读页排版弹层同控件，拖动即时生效
              </p>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-6">
              <Row label="AI 提供方" description="选择模型服务商">
                <select
                  value={config.provider}
                  onChange={(e) => handleProviderChange(e.target.value as ModelProvider)}
                  className="h-10 w-56 rounded-[var(--radius-control)] border border-[var(--sand)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] focus:outline-2 focus:outline-[var(--primary)]"
                >
                  <option value="openai">OpenAI (GPT-4o)</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="custom">自定义</option>
                </select>
              </Row>

              <Row label="API Key" description="仅保存在本机">
                <div className="flex items-center gap-3">
                  <div className="relative w-72">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={config.apiKey}
                      onChange={(e) => updateConfig({ ...config, apiKey: e.target.value })}
                      placeholder="输入你的 API Key"
                      autoComplete="off"
                      className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--sand)] bg-[var(--input-bg)] pr-10 pl-3 text-sm text-[var(--text)] focus:outline-2 focus:outline-[var(--primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                      className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-[var(--text-2)] hover:text-[var(--text)]"
                    >
                      {showApiKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-deep)] hover:bg-[var(--primary-light)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-[var(--primary)]"
                  >
                    {isTesting && <Loader2Icon className="size-4 animate-spin" />}
                    {isTesting ? '测试中…' : '测试连接'}
                  </button>
                </div>
              </Row>

              {config.provider === 'custom' && (
                <>
                  <Row label="API Base URL" description="自定义服务的地址">
                    <input
                      type="url"
                      value={config.baseUrl || ''}
                      onChange={(e) => updateConfig({ ...config, baseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                      className={`h-10 w-72 rounded-[var(--radius-control)] border bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] focus:outline-2 focus:outline-[var(--primary)] ${
                        baseUrlInvalid ? 'border-[var(--error)]' : 'border-[var(--sand)]'
                      }`}
                    />
                  </Row>
                  <Row label="模型名称" description="自定义服务的模型 ID">
                    <input
                      type="text"
                      value={config.modelName || ''}
                      onChange={(e) => updateConfig({ ...config, modelName: e.target.value })}
                      placeholder="例如：gpt-4, claude-3-opus"
                      className="h-10 w-72 rounded-[var(--radius-control)] border border-[var(--sand)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] focus:outline-2 focus:outline-[var(--primary)]"
                    />
                  </Row>
                </>
              )}

              {baseUrlInvalid && (
                <p role="alert" className="text-sm text-[var(--error)]">
                  API Base URL 格式不正确，需以 http:// 或 https:// 开头
                </p>
              )}

              {testResult && testResult.success && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#111827] px-3 py-1.5 text-xs font-medium text-white"
                  role="status"
                >
                  <CheckIcon />
                  已连接{testResult.ms !== undefined ? ` · ${testResult.ms}ms` : ''}
                </span>
              )}
              {testResult && !testResult.success && (
                <p role="alert" className="flex items-center gap-1.5 text-sm text-[var(--error)]">
                  <XIcon className="size-4" />
                  {testResult.message}
                </p>
              )}

              <Row
                label="允许联网搜索"
                description="搜索接口待接入后可用"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked="false"
                    disabled
                    aria-label="允许联网搜索（占位）"
                    className="relative h-6 w-10 cursor-not-allowed rounded-full bg-[var(--sand)] opacity-40"
                  >
                    <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow" />
                  </button>
                  <span className="rounded bg-[var(--primary-light)] px-2 py-0.5 text-xs text-[var(--primary-deep)] dark:text-[var(--primary)]">
                    占位
                  </span>
                </div>
              </Row>

              <Row label="回答语言" description="AI 回复使用的语言">
                <select
                  value={answerLanguage}
                  onChange={(e) => updateAnswerLanguage(e.target.value)}
                  className="h-10 w-56 rounded-[var(--radius-control)] border border-[var(--sand)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)] focus:outline-2 focus:outline-[var(--primary)]"
                >
                  {ANSWER_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </Row>
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-8">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">导出</p>
                <p className="mt-1 text-xs text-[var(--text-2)]">把全部概念笔记下载为 Markdown 文件</p>
                <button
                  type="button"
                  onClick={handleExportNotes}
                  className="mt-3 h-10 rounded-[var(--radius-control)] border border-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-deep)] hover:bg-[var(--primary-light)] dark:text-[var(--primary)]"
                >
                  导出全部笔记（Markdown）
                </button>
                {exportError && (
                  <p role="alert" className="mt-2 text-sm text-[var(--error)]">
                    {exportError}
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text)]">存储占用（只读）</p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="text-[var(--text-2)]">deer-notes</dt>
                    <dd className="text-[var(--text)]">· {formatBytes(notesBytes)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-[var(--text-2)]">deer-chat-sessions</dt>
                    <dd className="text-[var(--text)]">· {formatBytes(sessionsBytes)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-[var(--text-2)]">静默成功不弹 toast，失败才提示</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 一行设置项：左侧名称与说明，右侧控件。 */
function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text)]">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--text-2)]">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 阅读偏好滑杆行：名称 + 滑杆 + 当前值。 */
function SliderRow({
  label,
  description,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr_56px] items-center gap-4">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--text-2)]">{description}</p>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-[var(--primary)]"
      />
      <span className="text-right text-sm text-[var(--text-2)]">{display}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden="true">
      <path
        d="M3 8.5l3.5 3.5L13 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
