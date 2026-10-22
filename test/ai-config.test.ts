import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  getStoredConfig,
  setStoredConfig,
  clearStoredConfig,
  getDefaultConfig,
  validateBaseUrl,
  type AIModelConfig,
} from '../src/lib/ai-config';

describe('AI config utilities', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
      clear: vi.fn(() => { Object.keys(store).forEach(key => delete store[key]); }),
    };

    vi.stubGlobal('window', { localStorage: mockLocalStorage });
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getStoredConfig', () => {
    it('returns null when nothing is stored', () => {
      expect(getStoredConfig()).toBeNull();
    });

    it('returns the stored config when valid', () => {
      const config: AIModelConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
      };
      store['deer-ai-config'] = JSON.stringify(config);
      const result = getStoredConfig();
      expect(result).toEqual(config);
    });

    it('returns null when stored data is invalid JSON', () => {
      store['deer-ai-config'] = 'not-json';
      expect(getStoredConfig()).toBeNull();
    });

    it('returns null when stored config is missing required fields', () => {
      store['deer-ai-config'] = JSON.stringify({ provider: 'openai' });
      expect(getStoredConfig()).toBeNull();
    });
  });

  describe('setStoredConfig', () => {
    it('stores config to localStorage', () => {
      const config: AIModelConfig = {
        provider: 'anthropic',
        apiKey: 'test-key',
      };
      setStoredConfig(config);
      expect(store['deer-ai-config']).toBe(JSON.stringify(config));
    });
  });

  describe('clearStoredConfig', () => {
    it('removes config from localStorage', () => {
      store['deer-ai-config'] = JSON.stringify({ provider: 'openai', apiKey: 'key' });
      clearStoredConfig();
      expect(store['deer-ai-config']).toBeUndefined();
    });
  });

  describe('getDefaultConfig', () => {
    it('returns OpenAI defaults', () => {
      const config = getDefaultConfig('openai');
      expect(config.provider).toBe('openai');
      expect(config.baseUrl).toBe('https://api.openai.com/v1');
      expect(config.modelName).toBe('gpt-4o');
      expect(config.apiKey).toBe('');
    });

    it('returns Anthropic defaults', () => {
      const config = getDefaultConfig('anthropic');
      expect(config.provider).toBe('anthropic');
      expect(config.baseUrl).toBe('https://api.anthropic.com');
      expect(config.modelName).toBe('claude-3-5-sonnet-20241022');
    });

    it('returns DeepSeek defaults', () => {
      const config = getDefaultConfig('deepseek');
      expect(config.provider).toBe('deepseek');
      expect(config.baseUrl).toBe('https://api.deepseek.com/v1');
      expect(config.modelName).toBe('deepseek-chat');
      expect(config.apiKey).toBe('');
    });

    it('returns empty custom defaults', () => {
      const config = getDefaultConfig('custom');
      expect(config.provider).toBe('custom');
      expect(config.baseUrl).toBe('');
      expect(config.modelName).toBe('');
    });
  });

  describe('validateBaseUrl', () => {
    it('accepts empty URL (optional for built-in providers)', () => {
      expect(validateBaseUrl('')).toBe(true);
    });

    it('accepts valid HTTPS URL', () => {
      expect(validateBaseUrl('https://api.example.com/v1')).toBe(true);
    });

    it('accepts valid HTTP URL', () => {
      expect(validateBaseUrl('http://localhost:11434/v1')).toBe(true);
    });

    it('rejects invalid URL', () => {
      expect(validateBaseUrl('not-a-url')).toBe(false);
    });

    it('rejects URL with invalid protocol', () => {
      expect(validateBaseUrl('ftp://example.com')).toBe(false);
    });
  });
});
