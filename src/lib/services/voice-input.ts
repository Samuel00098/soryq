export type VoiceInputCallbacks = {
  onStart?: () => void;
  onResult: (transcript: string) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
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

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
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
  if (typeof window === 'undefined') {
    return 'Voice input is only available in the browser.';
  }

  if (!window.isSecureContext) {
    return 'Voice input requires localhost or HTTPS.';
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This runtime cannot access the microphone.';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return null;
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

  return {
    isSupported() {
      return !!getSpeechRecognitionCtor();
    },

    async start() {
      if (starting) return;
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
        if (stopRequested && event?.error === 'aborted') {
          return;
        }
        callbacks.onError?.(mapRecognitionError(event?.error));
      };

      recognizer.onend = () => {
        starting = false;
        callbacks.onEnd?.();
        recognition = null;
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
      recognition?.stop();
      recognition = null;
    },
  };
}
