import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import {
  currentVoiceInputModel,
  getDefaultVoiceInputModel,
  getProviderDef,
  voiceInputProvider,
  voiceInputUsesModelTranscription,
} from '$lib/stores/settings';
import { getProviderApiKeyLocal } from '$lib/services/ai-keychain';

export type VoiceInputCallbacks = {
  onStart?: () => void;
  onResult: (transcript: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  onProcessingStart?: (message: string) => void;
};

export type VoiceInputSession = {
  start: () => Promise<void>;
  stop: () => void;
  isSupported: () => boolean;
};

export type VoiceRefineOptions = {
  allowNewLines?: boolean;
  spokenPunctuation?: boolean;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: null | (() => void);
  onresult: null | ((event: any) => void);
  onerror: null | ((event: any) => void);
  onend: null | (() => void);
  start: () => void;
  stop: () => void;
};

type AudioContextCtor = new () => AudioContext;
const GOOGLE_VAD_RMS_THRESHOLD = 0.015;
// How long of a silence ends an utterance. Kept tight so transcription fires
// quickly after the user stops talking; still long enough to ride out the
// natural mid-sentence pauses that would otherwise cut the user off.
const GOOGLE_VAD_SILENCE_MS = 650;

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  return (window as any).AudioContext || (window as any).webkitAudioContext || null;
}

function getPreferredSpeechLanguage() {
  if (typeof navigator === 'undefined') return 'en-US';
  return navigator.languages?.find(Boolean) || navigator.language || 'en-US';
}

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  length?: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

function getBestAlternative(result: SpeechRecognitionResultLike) {
  const alternatives = Array.from({ length: result.length ?? 0 }, (_, index) => result[index]).filter(Boolean);
  if (alternatives.length === 0) return '';

  const best = alternatives.reduce<SpeechRecognitionAlternativeLike>((winner, candidate) => {
    if (!winner) return candidate;
    return (candidate.confidence ?? 0) > (winner.confidence ?? 0) ? candidate : winner;
  }, alternatives[0]);

  return best?.transcript?.trim() || '';
}

function buildTranscript(results: ArrayLike<SpeechRecognitionResultLike>) {
  const finalSegments: string[] = [];
  let interimTranscript = '';

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const transcript = getBestAlternative(result);
    if (!transcript) continue;

    if (result.isFinal) {
      finalSegments[i] = transcript;
    } else {
      interimTranscript = transcript;
    }
  }

  return [...finalSegments.filter(Boolean), interimTranscript].filter(Boolean).join(' ').trim();
}

const SPOKEN_PUNCTUATION_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\bnew line\b/gi, '\n'],
  [/\bline break\b/gi, '\n'],
  [/\bnext line\b/gi, '\n'],
  [/\bcomma\b/gi, ','],
  [/\bperiod\b/gi, '.'],
  [/\bfull stop\b/gi, '.'],
  [/\bdot\b/gi, '.'],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation mark\b/gi, '!'],
  [/\bexclamation point\b/gi, '!'],
  [/\bcolon\b/gi, ':'],
  [/\bsemicolon\b/gi, ';'],
  [/\bdash\b/gi, '-'],
  [/\bhyphen\b/gi, '-'],
  [/\bslash\b/gi, '/'],
  [/\bbackslash\b/gi, '\\'],
  [/\bopen parenthesis\b/gi, '('],
  [/\bclose parenthesis\b/gi, ')'],
  [/\bopen paren\b/gi, '('],
  [/\bclose paren\b/gi, ')'],
  [/\bopen bracket\b/gi, '['],
  [/\bclose bracket\b/gi, ']'],
  [/\bopen brace\b/gi, '{'],
  [/\bclose brace\b/gi, '}'],
  [/\bquote\b/gi, '"'],
  [/\bdouble quote\b/gi, '"'],
  [/\bapostrophe\b/gi, "'"],
];

export function refineVoiceTranscript(input: string, options: VoiceRefineOptions = {}) {
  const { allowNewLines = false, spokenPunctuation = true } = options;
  let text = input.replace(/\r\n?/g, '\n').trim();

  if (!text) return '';

  if (spokenPunctuation) {
    for (const [pattern, replacement] of SPOKEN_PUNCTUATION_REPLACEMENTS) {
      text = text.replace(pattern, replacement);
    }
  }

  if (!allowNewLines) {
    text = text.replace(/\s*\n+\s*/g, ' ');
  } else {
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
  }

  if (allowNewLines) {
    text = text
      .split('\n')
      .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
      .join('\n');
  } else {
    text = text.replace(/[ \t]{2,}/g, ' ');
  }

  text = text.replace(/\s+([,.;:!?])/g, '$1');

  return text.trim();
}

export function mergeVoiceTranscript(base: string, transcript: string, separator = ' ') {
  const cleanBase = base.trimEnd();
  const cleanTranscript = transcript.trim();

  if (!cleanBase) return cleanTranscript;
  if (!cleanTranscript) return cleanBase;

  return `${cleanBase}${separator}${cleanTranscript}`;
}

async function verifyMicrophoneAccess(): Promise<string | null> {
  const stream = await requestMicrophoneStream();
  if (typeof stream === 'string') {
    return stream;
  }
  stream.getTracks().forEach((track) => track.stop());
  return null;
}

async function requestMicrophoneStream(): Promise<MediaStream | string> {
  if (typeof window === 'undefined') {
    return 'Voice input is only available in the browser.';
  }

  if (!window.isSecureContext) {
    return 'Voice input requires localhost or HTTPS.';
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This runtime cannot access the microphone.';
  }

  // Check permission state before prompting so we can show our own dialog
  // instead of the browser bar when the user hasn't decided yet.
  if (navigator.permissions) {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (status.state === 'denied') {
        return 'Microphone access denied. Enable microphone permissions and try again.';
      }
      if (status.state === 'prompt') {
        const { requestPermission } = await import('$lib/stores/permissions');
        const granted = await requestPermission('microphone');
        if (!granted) {
          return 'Microphone access was not allowed.';
        }
      }
    } catch {
      // Permissions API unavailable — fall through to getUserMedia which handles it natively
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
      return 'Microphone access denied. Enable microphone permissions and try again.';
    }
    if (err?.name === 'NotFoundError') {
      return 'No microphone was found.';
    }
    if (err?.name === 'NotReadableError' || err?.name === 'AbortError') {
      return 'Microphone capture failed. Another app may be using it.';
    }
    return 'Could not access the microphone.';
  }
}

function pcmToWavBytes(chunks: Float32Array[], sampleRate: number) {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

function mapRecognitionError(code: string | undefined) {
  switch (code) {
    case 'aborted':
      return 'Voice input was stopped.';
    case 'no-speech':
      return 'No speech was detected.';
    case 'audio-capture':
      return 'Microphone capture failed.';
    case 'not-allowed':
      return 'Microphone access denied.';
    case 'network':
      return 'Speech recognition network error.';
    default:
      return code ? `Voice input error: ${code}` : 'Voice input failed.';
  }
}

export function createVoiceInputSession(callbacks: VoiceInputCallbacks): VoiceInputSession {
  let recognition: BrowserSpeechRecognition | null = null;
  let starting = false;
  let stopRequested = false;
  let transcriptionPending = false;
  let captureStream: MediaStream | null = null;
  let captureContext: AudioContext | null = null;
  let captureSource: MediaStreamAudioSourceNode | null = null;
  let captureProcessor: ScriptProcessorNode | null = null;
  let capturedChunks: Float32Array[] = [];
  let captureSampleRate = 16_000;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let speechDetected = false;

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function clearCaptureState() {
    clearSilenceTimer();
    captureProcessor?.disconnect();
    captureSource?.disconnect();
    if (captureContext && captureContext.state !== 'closed') {
      void captureContext.close().catch(() => undefined);
    }
    captureStream?.getTracks().forEach((track) => track.stop());
    captureProcessor = null;
    captureSource = null;
    captureContext = null;
    captureStream = null;
    capturedChunks = [];
    speechDetected = false;
  }

  function autoStopAfterSilence() {
    if (stopRequested || transcriptionPending || (!captureStream && !captureContext)) return;
    stopRequested = true;
    void finishGoogleTranscription();
  }

  async function finishGoogleTranscription() {
    if (transcriptionPending) return;
    transcriptionPending = true;
    clearSilenceTimer();
    callbacks.onProcessingStart?.('Transcribing with Google…');

    if (capturedChunks.length === 0) {
      clearCaptureState();
      transcriptionPending = false;
      stopRequested = false;
      callbacks.onEnd?.();
      return;
    }

    const bytes = pcmToWavBytes(capturedChunks, captureSampleRate);
    clearCaptureState();

    try {
      const provider = get(voiceInputProvider);
      const providerDef = getProviderDef(provider === 'webspeech' ? 'google' : provider);
      const apiKey = getProviderApiKeyLocal(providerDef.id) ?? '';
      if (!apiKey) {
        throw new Error(`${providerDef.label} API key is missing. Add it in Settings to use voice mode.`);
      }
      const model = get(currentVoiceInputModel) || getDefaultVoiceInputModel(provider as 'google' | 'openrouter');
      const transcript = await invoke<string>('ai_transcribe_audio', {
        audioBytes: Array.from(bytes),
        mimeType: 'audio/wav',
        provider,
        model,
        apiKey,
      });
      callbacks.onResult(transcript.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onError?.(message || 'Google transcription failed.');
    } finally {
      transcriptionPending = false;
      stopRequested = false;
      callbacks.onEnd?.();
    }
  }

  return {
    isSupported() {
      const provider = get(voiceInputProvider);
      if (voiceInputUsesModelTranscription(provider)) {
        return !!getAudioContextCtor() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
      }
      return !!getSpeechRecognitionCtor();
    },

    async start() {
      if (starting || recognition) return;
      if (captureStream || transcriptionPending) return;
      const provider = get(voiceInputProvider);

      if (voiceInputUsesModelTranscription(provider)) {
        const AudioContextClass = getAudioContextCtor();
        if (!AudioContextClass) {
          callbacks.onError?.('Voice input is not supported in this runtime.');
          return;
        }

        starting = true;
        stopRequested = false;
        const streamOrError = await requestMicrophoneStream();
        if (typeof streamOrError === 'string') {
          starting = false;
          callbacks.onError?.(streamOrError);
          return;
        }
        if (stopRequested) {
          starting = false;
          streamOrError.getTracks().forEach((track) => track.stop());
          return;
        }

        try {
          captureStream = streamOrError;
          captureContext = new AudioContextClass();
          captureSampleRate = captureContext.sampleRate;
          captureSource = captureContext.createMediaStreamSource(streamOrError);
          captureProcessor = captureContext.createScriptProcessor(4096, 1, 1);
          capturedChunks = [];
          speechDetected = false;
          clearSilenceTimer();

          captureProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
            if (stopRequested) return;
            const input = event.inputBuffer.getChannelData(0);
            capturedChunks.push(new Float32Array(input));
            let sumSquares = 0;
            for (let i = 0; i < input.length; i += 1) {
              sumSquares += input[i] * input[i];
            }
            const rms = Math.sqrt(sumSquares / Math.max(input.length, 1));
            if (rms >= GOOGLE_VAD_RMS_THRESHOLD) {
              speechDetected = true;
              clearSilenceTimer();
              return;
            }
            if (!speechDetected || silenceTimer) return;
            silenceTimer = setTimeout(() => {
              silenceTimer = null;
              autoStopAfterSilence();
            }, GOOGLE_VAD_SILENCE_MS);
          };

          captureSource.connect(captureProcessor);
          captureProcessor.connect(captureContext.destination);
          starting = false;
          callbacks.onStart?.();
        } catch {
          starting = false;
          clearCaptureState();
          callbacks.onError?.('Could not start voice input.');
        }
        return;
      }

      const SpeechRecognition = getSpeechRecognitionCtor();
      if (!SpeechRecognition) {
        callbacks.onError?.('Voice input is not supported in this runtime.');
        return;
      }

      starting = true;
      stopRequested = false;
      const micError = await verifyMicrophoneAccess();
      if (micError) {
        starting = false;
        callbacks.onError?.(micError);
        return;
      }
      if (stopRequested) {
        starting = false;
        return;
      }

      const recognizer: BrowserSpeechRecognition = new SpeechRecognition();
      recognition = recognizer;
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 3;
      recognizer.lang = getPreferredSpeechLanguage();

      recognizer.onstart = () => {
        starting = false;
        if (stopRequested) {
          recognizer.stop();
          return;
        }
        callbacks.onStart?.();
      };

      recognizer.onresult = (event: any) => {
        const transcript = buildTranscript(event?.results ?? []);
        callbacks.onResult(transcript);
      };

      recognizer.onerror = (event: any) => {
        starting = false;
        if (event?.error === 'aborted') {
          return;
        }
        callbacks.onError?.(mapRecognitionError(event?.error));
      };

      recognizer.onend = () => {
        starting = false;
        if (recognition === recognizer) {
          recognition = null;
        }
        stopRequested = false;
        callbacks.onEnd?.();
      };

      try {
        recognizer.start();
      } catch {
        starting = false;
        callbacks.onError?.('Could not start voice input.');
      }
    },

    stop() {
      stopRequested = true;
      if (captureStream || captureContext) {
        void finishGoogleTranscription();
        return;
      }
      recognition?.stop();
      recognition = null;
    },
  };
}
