// Fully offline NVIDIA Parakeet TDT v3 speech-to-text, run in the renderer via
// onnxruntime-web (WASM). Wraps the `parakeet.js` library, which owns the mel
// preprocessing, encoder/decoder-joint ONNX inference, TDT decoding and
// tokenisation. We feed it the ONNX files the Rust side downloaded to disk by
// turning their bytes into object URLs.

import { fromUrls, type ParakeetModel } from 'parakeet.js';
import { invoke } from '@tauri-apps/api/core';

const TARGET_SAMPLE_RATE = 16000;

// Local filenames written by the Rust downloader (see PARAKEET_FILES in
// commands/models.rs). Order: encoder, decoder/joint, tokenizer, preprocessor.
const PARAKEET_FILENAMES = {
  encoder: 'parakeet-encoder.int8.onnx',
  decoder: 'parakeet-decoder.int8.onnx',
  tokenizer: 'parakeet-vocab.txt',
  preprocessor: 'parakeet-preprocessor.onnx',
} as const;

let modelPromise: Promise<ParakeetModel> | null = null;
let loadedModelId: string | null = null;
const objectUrls: string[] = [];

/** Release a cached model + its object URLs (e.g. after delete/re-download). */
export function resetParakeet(): void {
  modelPromise = null;
  loadedModelId = null;
  for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
}

async function fileObjectUrl(filename: string): Promise<string> {
  const buf = await invoke<ArrayBuffer>('read_model_file_bytes', { filename });
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
  objectUrls.push(url);
  return url;
}

async function getModel(modelId: string): Promise<ParakeetModel> {
  if (modelPromise && loadedModelId === modelId) return modelPromise;
  resetParakeet();
  loadedModelId = modelId;
  modelPromise = (async () => {
    const [encoderUrl, decoderUrl, tokenizerUrl, preprocessorUrl] = await Promise.all([
      fileObjectUrl(PARAKEET_FILENAMES.encoder),
      fileObjectUrl(PARAKEET_FILENAMES.decoder),
      fileObjectUrl(PARAKEET_FILENAMES.tokenizer),
      fileObjectUrl(PARAKEET_FILENAMES.preprocessor),
    ]);
    // WASM backend keeps this working on every platform/webview without a
    // WebGPU dependency. (WebGPU would speed up the encoder where available.)
    return fromUrls({ encoderUrl, decoderUrl, tokenizerUrl, preprocessorUrl, backend: 'wasm' });
  })();
  try {
    return await modelPromise;
  } catch (err) {
    resetParakeet();
    throw err;
  }
}

/**
 * Resample mono float PCM to 16 kHz with linear interpolation. Parakeet expects
 * 16 kHz; capture usually runs at the device rate (typically 44.1/48 kHz).
 */
export function resampleTo16k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === TARGET_SAMPLE_RATE || input.length === 0) return input;
  const ratio = srcRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Flatten captured Float32 chunks into a single contiguous buffer. */
export function concatChunks(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Trim leading/trailing near-silence (mono 16 kHz). Parakeet's greedy TDT
 * decoder is prone to hallucinating filler ("yeah", "mm-hmm") or looping a
 * phrase on silent padding — and our capture buffer always carries some: the
 * audio before speech is detected, plus the ~650 ms of trailing silence the VAD
 * waits out before stopping. Cloud STT shrugs that off; Parakeet doesn't, so we
 * strip it before inference. Uses a peak-relative RMS gate over short frames so
 * it adapts to mic gain. Returns an empty buffer when nothing crosses the gate.
 */
export function trimSilence(pcm: Float32Array, sampleRate: number): Float32Array {
  if (pcm.length === 0) return pcm;
  const frame = Math.max(1, Math.round(sampleRate * 0.02)); // 20 ms frames
  const frameCount = Math.ceil(pcm.length / frame);
  const rms = new Float32Array(frameCount);
  let peak = 0;
  for (let f = 0; f < frameCount; f++) {
    const start = f * frame;
    const end = Math.min(pcm.length, start + frame);
    let sum = 0;
    for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
    const r = Math.sqrt(sum / Math.max(1, end - start));
    rms[f] = r;
    if (r > peak) peak = r;
  }
  // Floor keeps a quiet-but-not-silent buffer from passing; the peak-relative
  // term tracks the actual voiced level for normal-volume speech.
  const gate = Math.max(0.0075, peak * 0.15);
  let firstF = 0;
  while (firstF < frameCount && rms[firstF] < gate) firstF++;
  let lastF = frameCount - 1;
  while (lastF > firstF && rms[lastF] < gate) lastF--;
  if (firstF >= lastF) return new Float32Array(0); // no voiced frames
  const marginF = Math.round((sampleRate * 0.08) / frame); // keep ~80 ms padding
  const startF = Math.max(0, firstF - marginF);
  const endF = Math.min(frameCount - 1, lastF + marginF);
  return pcm.subarray(startF * frame, Math.min(pcm.length, (endF + 1) * frame));
}

function windowEqual(words: string[], a: number, b: number, w: number): boolean {
  for (let k = 0; k < w; k++) {
    if (words[a + k].toLowerCase() !== words[b + k].toLowerCase()) return false;
  }
  return true;
}

/**
 * Collapse runaway repetition in a transcript. A looping TDT decode emits the
 * same word or phrase many times in a row ("go to the store go to the store go
 * to the store…"); we keep a single copy of any block that repeats abnormally
 * often. Thresholds are conservative so genuine emphasis ("no no no", "very
 * very very") is left alone — only the pathological long runs are collapsed.
 */
export function collapseRepetitions(text: string): string {
  if (!text) return text;
  let words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4) return text;
  for (let w = 1; w <= 6; w++) {
    const minRepeats = w === 1 ? 5 : 3; // a 2+ word block repeated 3× is never natural
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      let repeats = 1;
      while (i + (repeats + 1) * w <= words.length && windowEqual(words, i, i + repeats * w, w)) {
        repeats++;
      }
      if (repeats >= minRepeats) {
        for (let k = 0; k < w; k++) out.push(words[i + k]); // keep one copy
        i += repeats * w;
      } else {
        out.push(words[i]);
        i += 1;
      }
    }
    words = out;
  }
  return words.join(' ');
}

// Minimum voiced audio (after trimming) worth running the model on. Anything
// shorter is treated as silence/noise and returns empty rather than risking a
// hallucinated filler word.
const MIN_VOICED_SAMPLES = TARGET_SAMPLE_RATE * 0.2; // 200 ms

/** Transcribe captured PCM chunks (at `sampleRate`) to text. */
export async function transcribeParakeet(
  chunks: Float32Array[],
  sampleRate: number,
  modelId: string,
): Promise<string> {
  const model = await getModel(modelId);
  const pcm = trimSilence(resampleTo16k(concatChunks(chunks), sampleRate), TARGET_SAMPLE_RATE);
  if (pcm.length < MIN_VOICED_SAMPLES) return '';
  const result = await model.transcribe(pcm, TARGET_SAMPLE_RATE, {});
  const text = (result?.utterance_text ?? (result as { text?: string })?.text ?? '').trim();
  return collapseRepetitions(text);
}
