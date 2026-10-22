'use client';

import { useState } from 'react';
import {
  type AIModelConfig,
  type ModelProvider,
  getStoredConfig,
  setStoredConfig,
  getDefaultConfig,
  validateBaseUrl,
  testConnection,
} from '@/src/lib/ai-config';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [config, setConfig] = useState<AIModelConfig>(() => {
    const stored = getStoredConfig();
    return stored || getDefaultConfig('openai');
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function handleProviderChange(provider: ModelProvider) {
    const defaults = getDefaultConfig(provider);
    setConfig({ ...defaults, apiKey: config.apiKey });
    setTestResult(null);
  }

  function handleSave() {
    if (config.provider === 'custom' && config.baseUrl && !validateBaseUrl(config.baseUrl)) {
      setTestResult({ success: false, message: 'API Base URL 格式不正确，需以 http:// 或 https:// 开头' });
      return;
    }

    if (!config.apiKey) {
      setTestResult({ success: false, message: '请输入 API Key' });
      return;
    }

    setIsSaving(true);
    setStoredConfig(config);
    setTestResult({ success: true, message: '配置已保存' });
    setTimeout(() => {
      setIsSaving(false);
      onClose();
    }, 800);
  }

  async function handleTestConnection() {
    if (config.provider === 'custom' && config.baseUrl && !validateBaseUrl(config.baseUrl)) {
      setTestResult({ success: false, message: 'API Base URL 格式不正确' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    const result = await testConnection(config);
    setTestResult(result);
    setIsTesting(false);
  }

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="AI 模型设置">
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>AI 模型配置</h2>
          <button className="close-btn" onClick={onClose} type="button" aria-label="关闭设置面板">
            ✕
          </button>
        </div>

        <div className="settings-body">
          <div className="form-group">
            <label htmlFor="provider">模型提供商</label>
            <select
              id="provider"
              value={config.provider}
              onChange={(e) => handleProviderChange(e.target.value as ModelProvider)}
            >
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="custom">自定义</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="apiKey">API Key</label>
            <div className="api-key-input">
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="输入你的 API Key"
                autoComplete="off"
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {config.provider === 'custom' && (
            <>
              <div className="form-group">
                <label htmlFor="baseUrl">API Base URL</label>
                <input
                  id="baseUrl"
                  type="url"
                  value={config.baseUrl || ''}
                  onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div className="form-group">
                <label htmlFor="modelName">模型名称</label>
                <input
                  id="modelName"
                  type="text"
                  value={config.modelName || ''}
                  onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                  placeholder="例如：gpt-4, claude-3-opus"
                />
              </div>
            </>
          )}

          {testResult && (
            <div className={`test-result ${testResult.success ? 'success' : 'error'}`} role="alert">
              {testResult.message}
            </div>
          )}

          <div className="settings-actions">
            <button
              className="test-btn"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving}
              type="button"
            >
              {isTesting ? '测试中…' : '测试连接'}
            </button>
            <button
              className="save-btn"
              onClick={handleSave}
              disabled={isTesting || isSaving}
              type="button"
            >
              {isSaving ? '已保存 ✓' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
