import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const getProviderApiKeyLocal = vi.hoisted(() => vi.fn((_provider: string): string | null => null));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('$lib/services/ai-keychain', () => ({ getProviderApiKeyLocal }));

import { createVoiceInputSession } from './voice-input';
import { voiceInputProvider } from '$lib/stores/settings';

type MockTrack = { stop: ReturnType<typeof vi.fn> };
type MockStream = { getTracks: () => MockTrack[] };

class MockScriptProcessor {
  onaudioprocess: null | ((event: any) => void) = null;
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockMediaStreamSource {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioContext {
  sampleRate = 16_000;
  state = 'running';
  destination = {};
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createMediaStreamSource = vi.fn(() => new MockMediaStreamSource());
  createScriptProcessor = vi.fn(() => {
    const processor = new MockScriptProcessor();
    audioProcessors.push(processor);
    return processor as any;
  });
}

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = 'en-US';
  maxAlternatives = 1;
  onstart: null | (() => void) = null;
  onresult: null | ((event: any) => void) = null;
  onerror: null | ((event: any) => void) = null;
  onend: null | (() => void) = null;
  start = vi.fn();
  stop = vi.fn();

  constructor() {
    recognizers.push(this);
  }
}

let recognizers: MockSpeechRecognition[] = [];
let audioProcessors: MockScriptProcessor[] = [];
const permissionsQuery = vi.fn();
const getUserMedia = vi.fn<() => Promise<MockStream>>();

function installBrowserStubs() {
  const mockWindow = {};
  Object.defineProperty(globalThis, 'window', {
    value: mockWindow,
    configurable: true,
  });
  Object.defineProperty(mockWindow, 'SpeechRecognition', {
    value: MockSpeechRecognition,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(mockWindow, 'webkitSpeechRecognition', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(mockWindow, 'AudioContext', {
    value: MockAudioContext,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(mockWindow, 'webkitAudioContext', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(mockWindow, 'isSecureContext', {
    value: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      language: 'en-US',
      languages: ['en-US'],
      permissions: { query: permissionsQuery },
      mediaDevices: { getUserMedia },
    },
    configurable: true,
  });
}

beforeEach(() => {
  recognizers = [];
  audioProcessors = [];
  invoke.mockReset();
  getProviderApiKeyLocal.mockReset();
  getProviderApiKeyLocal.mockImplementation((_provider: string) => null);
  voiceInputProvider.set('webspeech');
  permissionsQuery.mockReset();
  permissionsQuery.mockResolvedValue({ state: 'granted' });
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }],
  });
  installBrowserStubs();
});

describe('createVoiceInputSession', () => {
  it('ignores aborted speech-recognition errors', async () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    const session = createVoiceInputSession({
      onResult: vi.fn(),
      onError,
      onEnd,
    });

    await session.start();
    expect(recognizers).toHaveLength(1);

    const recognizer = recognizers[0];
    recognizer.onstart?.();
    recognizer.onerror?.({ error: 'aborted' });
    recognizer.onend?.();

    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight start before recognition begins', async () => {
    let resolveMedia: ((stream: MockStream) => void) | null = null;
    getUserMedia.mockImplementation(
      () =>
        new Promise<MockStream>((resolve) => {
          resolveMedia = resolve;
        })
    );

    const onStart = vi.fn();
    const onError = vi.fn();
    const session = createVoiceInputSession({
      onResult: vi.fn(),
      onStart,
      onError,
    });

    const startPromise = session.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolveMedia).not.toBeNull();
    session.stop();
    (resolveMedia as ((stream: MockStream) => void) | null)?.({
      getTracks: () => [{ stop: vi.fn() }],
    });
    await startPromise;

    expect(recognizers).toHaveLength(0);
    expect(onStart).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('auto-finishes Google transcription after speech followed by silence', async () => {
    vi.useFakeTimers();
    voiceInputProvider.set('google');
    getProviderApiKeyLocal.mockImplementation((provider: string) => (provider === 'google' ? 'AIza-test' : null));
    invoke.mockResolvedValue('open the terminal');

    const onStart = vi.fn();
    const onResult = vi.fn();
    const onProcessingStart = vi.fn();
    const onEnd = vi.fn();

    const session = createVoiceInputSession({
      onStart,
      onResult,
      onProcessingStart,
      onEnd,
    });

    await session.start();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(audioProcessors).toHaveLength(1);

    const processor = audioProcessors[0];
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([0.25, 0.2, 0.18, 0.22]) },
    });
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([0, 0, 0, 0]) },
    });

    await vi.advanceTimersByTimeAsync(950);
    await Promise.resolve();

    expect(onProcessingStart).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('ai_transcribe_audio', expect.objectContaining({
      provider: 'google',
      model: 'gemini-2.5-flash',
      apiKey: 'AIza-test',
      mimeType: 'audio/wav',
    }));
    expect(onResult).toHaveBeenCalledWith('open the terminal');
    expect(onEnd).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('routes model transcription through OpenRouter when selected', async () => {
    vi.useFakeTimers();
    voiceInputProvider.set('openrouter');
    getProviderApiKeyLocal.mockImplementation((provider: string) => (provider === 'openrouter' ? 'sk-or-test' : null));
    invoke.mockResolvedValue('ship the fix');

    const onResult = vi.fn();
    const session = createVoiceInputSession({
      onResult,
      onProcessingStart: vi.fn(),
      onEnd: vi.fn(),
    });

    await session.start();
    expect(audioProcessors).toHaveLength(1);

    const processor = audioProcessors[0];
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([0.3, 0.24, 0.2, 0.18]) },
    });
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([0, 0, 0, 0]) },
    });

    await vi.advanceTimersByTimeAsync(950);
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith('ai_transcribe_audio', expect.objectContaining({
      provider: 'openrouter',
      model: 'openai/whisper-1',
      apiKey: 'sk-or-test',
      mimeType: 'audio/wav',
    }));
    expect(onResult).toHaveBeenCalledWith('ship the fix');

    vi.useRealTimers();
  });
});
