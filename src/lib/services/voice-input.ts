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

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
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
  let finalTranscript = '';
  let interimTranscript = '';

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
      finalTranscript = '';
      interimTranscript = '';
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
      recognizer.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';

      recognizer.onstart = () => {
        starting = false;
        if (stopRequested) {
          recognizer.stop();
          return;
        }
        callbacks.onStart?.();
      };

      recognizer.onresult = (event: any) => {
        interimTranscript = '';
        const results = event?.results ?? [];
        const startIndex = event?.resultIndex ?? 0;
        for (let i = startIndex; i < results.length; i += 1) {
          const result = results[i];
          const transcript = result?.[0]?.transcript?.trim();
          if (!transcript) continue;
          if (result.isFinal) {
            finalTranscript = `${finalTranscript} ${transcript}`.trim();
          } else {
            interimTranscript = transcript;
          }
        }
        const transcript = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();
        callbacks.onResult(transcript);
      };

      recognizer.onerror = (event: any) => {
        starting = false;
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
