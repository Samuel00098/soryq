// Fully offline Kokoro v1.0 text-to-speech, run in the renderer via WASM.
//
// Pipeline (matches the reference kokoro-js / kokoro-onnx implementations):
//   text -> espeak-ng phonemes (phonemizer, WASM) -> Kokoro token ids
//        -> onnxruntime-web inference (tokens + voice style vector + speed)
//        -> 24 kHz float32 waveform -> 16-bit PCM WAV
//
// The ONNX model (`kokoro-v1.0.onnx`) and the voice pack (`voices-v1.0.bin`,
// an npz of per-voice [510,1,256] float32 style vectors) are downloaded to disk
// by the Rust side and streamed here as raw bytes via Tauri commands.

import * as ort from 'onnxruntime-web';
import { phonemize as espeakPhonemize } from 'phonemizer';
import { unzipSync } from 'fflate';
import { invoke } from '@tauri-apps/api/core';
import { KOKORO_PAD_ID, tokenizePhonemes } from './kokoro-vocab';

const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;
// Context length is 512; reserve the two boundary tokens, so at most 510
// phoneme tokens. The voice pack likewise has 510 style rows (index 0..509).
const MAX_PHONEME_TOKENS = 510;
// Keep each synthesis pass comfortably under the 510-token ceiling. StyleTTS2's
// duration predictor degrades as a single pass approaches the limit and starts
// looping/repeating a phrase in the audio — the cause of the offline voice
// "stuttering one phrase over and over". So we split long input into
// word-bounded segments under this budget and stitch the waveforms together,
// matching how the reference kokoro-js handles long text.
const MAX_SEGMENT_TOKENS = 320;
// A short silence inserted between stitched segments so the joins don't click.
const SEGMENT_GAP_SAMPLES = Math.round(SAMPLE_RATE * 0.05); // ~50 ms

export interface KokoroAudioPayload {
  bytes: Uint8Array;
  mime_type: string;
}

// Run ONNX inference on a worker thread so a heavy synthesis pass can't block
// the renderer's main thread and freeze the UI (the cause of the lag/slowness
// when speaking with the offline engine). If the proxy worker can't be created
// — e.g. its asset fails to resolve offline — getSession() falls back to
// main-thread execution, so this is a best-effort responsiveness win that never
// breaks local TTS outright.
ort.env.wasm.proxy = true;
// WASM threads need SharedArrayBuffer, which only exists when the page is
// cross-origin isolated (COOP/COEP). Use a few threads when that's available
// for a speed-up; otherwise stay single-threaded so synthesis still works
// without special headers.
ort.env.wasm.numThreads =
  typeof self !== 'undefined' && self.crossOriginIsolated
    ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
    : 1;

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let sessionModelId: string | null = null;
let voicesPromise: Promise<Map<string, Float32Array>> | null = null;

/** Reset cached session/voices (e.g. after a model is deleted or re-downloaded). */
export function resetKokoro(): void {
  sessionPromise = null;
  sessionModelId = null;
  voicesPromise = null;
}

/**
 * Kick off the (expensive) one-time ONNX session + voice-pack load in the
 * background so the first spoken reply isn't blocked on a cold start. Safe to
 * call repeatedly — the underlying promises are cached, and any failure is
 * swallowed here so a real synthesis attempt can surface it instead.
 */
export function warmupKokoro(modelId: string): void {
  void getSession(modelId).catch(() => {});
  void getVoices().catch(() => {});
}

async function getSession(modelId: string): Promise<ort.InferenceSession> {
  if (sessionPromise && sessionModelId === modelId) return sessionPromise;
  sessionModelId = modelId;
  sessionPromise = (async () => {
    const buf = await invoke<ArrayBuffer>('read_tts_model_bytes', { modelId });
    const bytes = new Uint8Array(buf);
    try {
      return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    } catch (err) {
      // The off-main-thread proxy worker couldn't start (most likely its asset
      // failed to resolve offline). Fall back to main-thread execution so local
      // TTS keeps working — slower and blocking, but functional.
      if (ort.env.wasm.proxy) {
        console.warn('[kokoro] ONNX worker proxy unavailable; running on main thread', err);
        ort.env.wasm.proxy = false;
        return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      }
      throw err;
    }
  })();
  try {
    return await sessionPromise;
  } catch (err) {
    // Don't cache a failed load — let the next call retry.
    sessionPromise = null;
    sessionModelId = null;
    throw err;
  }
}

async function getVoices(): Promise<Map<string, Float32Array>> {
  if (voicesPromise) return voicesPromise;
  voicesPromise = (async () => {
    const buf = await invoke<ArrayBuffer>('read_tts_voices_bytes');
    return parseVoicePack(new Uint8Array(buf));
  })();
  try {
    return await voicesPromise;
  } catch (err) {
    voicesPromise = null;
    throw err;
  }
}

/** Parse the npz voice pack into a map of voice id -> flat float32 style data. */
export function parseVoicePack(npz: Uint8Array): Map<string, Float32Array> {
  const files = unzipSync(npz);
  const map = new Map<string, Float32Array>();
  for (const [name, data] of Object.entries(files)) {
    const voice = name.replace(/\.npy$/i, '');
    map.set(voice, parseNpyFloat32(data));
  }
  if (map.size === 0) throw new Error('Voice pack contained no voices');
  return map;
}

/**
 * Parse a little-endian float32 `.npy` (v1.x) array into a Float32Array. We only
 * need the raw values (shape is implicitly [510,1,256]); the header is parsed
 * solely to locate the data offset.
 */
export function parseNpyFloat32(buf: Uint8Array): Float32Array {
  if (buf.length < 10 || buf[0] !== 0x93 || String.fromCharCode(buf[1], buf[2], buf[3], buf[4], buf[5]) !== 'NUMPY') {
    throw new Error('Not a valid .npy array');
  }
  const major = buf[6];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let dataStart: number;
  if (major <= 1) {
    const headerLen = view.getUint16(8, true);
    dataStart = 10 + headerLen;
  } else {
    const headerLen = view.getUint32(8, true);
    dataStart = 12 + headerLen;
  }
  const count = (buf.byteLength - dataStart) >> 2;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = view.getFloat32(dataStart + i * 4, true);
  }
  return out;
}

/**
 * Run espeak-ng (WASM) and apply the Kokoro phoneme normalisations, returning a
 * single phoneme string ready for tokenisation.
 */
export async function textToPhonemes(text: string, lang = 'en-us'): Promise<string> {
  const result = await espeakPhonemize(text, lang);
  let ps = Array.isArray(result) ? result.join(' ') : String(result);
  // Normalisations from the reference kokoro phonemizer so the phoneme set
  // matches what the model was trained on.
  ps = ps
    .replace(/ʲ/g, 'j') // ʲ -> j
    .replace(/r/g, 'ɹ') // rhoticity
    .replace(/x/g, 'k') // velar fricative
    .replace(/ɬ/g, 'l'); // lateral fricative
  return ps.replace(/\s+/g, ' ').trim();
}

/**
 * Split a phoneme string into word-bounded segments, each within `budget`
 * tokens. Splitting on the space token (id 16) keeps whole words intact so the
 * join lands at a natural pause rather than mid-word. A single word longer than
 * the budget is emitted on its own (the per-segment synth still slice-guards it).
 */
export function splitPhonemesByTokenBudget(phonemes: string, budget = MAX_SEGMENT_TOKENS): string[] {
  const words = phonemes.split(' ').filter(Boolean);
  const segments: string[] = [];
  let buf = '';
  let bufTokens = 0;
  for (const word of words) {
    const wordTokens = tokenizePhonemes(word).length;
    if (wordTokens === 0) continue;
    const addTokens = (buf ? 1 : 0) + wordTokens; // +1 for the joining space token
    if (buf && bufTokens + addTokens > budget) {
      segments.push(buf);
      buf = word;
      bufTokens = wordTokens;
    } else {
      buf = buf ? `${buf} ${word}` : word;
      bufTokens += addTokens;
    }
  }
  if (buf) segments.push(buf);
  return segments;
}

/** Concatenate segment waveforms with a short silence between each. */
export function mergeWaveforms(waveforms: Float32Array[], gapSamples: number): Float32Array {
  if (waveforms.length === 1) return waveforms[0];
  const gaps = Math.max(0, waveforms.length - 1) * gapSamples;
  const total = waveforms.reduce((sum, w) => sum + w.length, 0) + gaps;
  const out = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < waveforms.length; i++) {
    out.set(waveforms[i], offset);
    offset += waveforms[i].length + (i < waveforms.length - 1 ? gapSamples : 0);
  }
  return out;
}

/** Run one Kokoro inference pass over an already token-budgeted segment. */
async function runKokoroSegment(
  session: ort.InferenceSession,
  voicePack: Float32Array,
  tokenIds: number[],
  speed: number,
): Promise<Float32Array> {
  // The style vector is chosen by the (unpadded) token count, capped at the last
  // available row of the voice pack.
  const styleRow = Math.min(tokenIds.length, voicePack.length / STYLE_DIM - 1);
  const style = voicePack.slice(styleRow * STYLE_DIM, styleRow * STYLE_DIM + STYLE_DIM);

  // Wrap with the boundary/pad token on both ends.
  const padded = new BigInt64Array(tokenIds.length + 2);
  padded[0] = BigInt(KOKORO_PAD_ID);
  for (let i = 0; i < tokenIds.length; i++) padded[i + 1] = BigInt(tokenIds[i]);
  padded[padded.length - 1] = BigInt(KOKORO_PAD_ID);

  const feeds: Record<string, ort.Tensor> = {
    style: new ort.Tensor('float32', style, [1, STYLE_DIM]),
    speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
  };
  // The kokoro-onnx release names the token input `tokens`; the onnx-community
  // export names it `input_ids`. Bind to whichever this model actually exposes.
  const tokenName =
    session.inputNames.find((n) => n === 'tokens' || n === 'input_ids') ?? session.inputNames[0];
  feeds[tokenName] = new ort.Tensor('int64', padded, [1, padded.length]);

  const results = await session.run(feeds);
  return results[session.outputNames[0]].data as Float32Array;
}

/** Synthesise one text chunk to a WAV payload. Long input is split into
 *  token-budgeted segments and stitched so synthesis never runs near the model's
 *  context limit (which makes it loop/repeat a phrase). */
export async function synthesizeKokoro(
  text: string,
  modelId: string,
  voice: string,
  speed = 1,
): Promise<KokoroAudioPayload> {
  const [session, voices] = await Promise.all([getSession(modelId), getVoices()]);

  let voicePack = voices.get(voice);
  if (!voicePack) {
    // The selected voice id isn't in the downloaded pack — fall back, but say so
    // out loud rather than silently speaking in a different voice.
    console.warn(
      `[kokoro] voice "${voice}" not found in the voice pack (have: ${[...voices.keys()].join(', ')}); falling back to af_heart`,
    );
    voicePack = voices.get('af_heart') ?? voices.values().next().value;
  }
  if (!voicePack) throw new Error('No Kokoro voices available');

  const phonemes = await textToPhonemes(text);
  const segments = splitPhonemesByTokenBudget(phonemes);

  const waveforms: Float32Array[] = [];
  for (const segment of segments) {
    let tokenIds = tokenizePhonemes(segment);
    if (tokenIds.length === 0) continue;
    if (tokenIds.length > MAX_PHONEME_TOKENS) tokenIds = tokenIds.slice(0, MAX_PHONEME_TOKENS);
    waveforms.push(await runKokoroSegment(session, voicePack, tokenIds, speed));
  }

  if (waveforms.length === 0) {
    return { bytes: new Uint8Array(0), mime_type: 'audio/wav' };
  }
  const waveform = mergeWaveforms(waveforms, SEGMENT_GAP_SAMPLES);
  return { bytes: encodeWav(waveform, SAMPLE_RATE), mime_type: 'audio/wav' };
}

/** Encode mono float32 [-1,1] samples as a 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}
