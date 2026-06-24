import { describe, expect, it, vi } from 'vitest';

vi.mock('parakeet.js', () => ({ fromUrls: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { collapseRepetitions, concatChunks, resampleTo16k, trimSilence } from './parakeet-local';

describe('concatChunks', () => {
  it('flattens chunks into one contiguous buffer', () => {
    const out = concatChunks([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles the empty case', () => {
    expect(concatChunks([]).length).toBe(0);
  });
});

describe('resampleTo16k', () => {
  it('returns the input unchanged when already 16 kHz', () => {
    const input = new Float32Array([0, 0.5, -0.5]);
    expect(resampleTo16k(input, 16000)).toBe(input);
  });

  it('downsamples 48 kHz to 16 kHz by a 3:1 ratio', () => {
    // 6 samples at 48k -> 2 samples at 16k.
    const input = new Float32Array([0, 1, 2, 3, 4, 5]);
    const out = resampleTo16k(input, 48000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0, 5); // srcPos 0 -> input[0]
    expect(out[1]).toBeCloseTo(3, 5); // srcPos 3 -> input[3]
  });

  it('upsamples and interpolates linearly between samples', () => {
    const input = new Float32Array([0, 10]);
    const out = resampleTo16k(input, 8000); // ratio 0.5 -> length doubles
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(5, 5); // halfway between 0 and 10
    expect(out[2]).toBeCloseTo(10, 5);
  });

  it('treats an empty buffer as empty', () => {
    expect(resampleTo16k(new Float32Array(0), 48000).length).toBe(0);
  });
});

describe('trimSilence', () => {
  const SR = 16000;

  function buffer(leadingSilenceMs: number, voicedMs: number, trailingSilenceMs: number): Float32Array {
    const ms = (n: number) => Math.round((SR * n) / 1000);
    const out = new Float32Array(ms(leadingSilenceMs) + ms(voicedMs) + ms(trailingSilenceMs));
    const voicedStart = ms(leadingSilenceMs);
    const voicedEnd = voicedStart + ms(voicedMs);
    for (let i = voicedStart; i < voicedEnd; i++) out[i] = Math.sin(i * 0.2) * 0.5; // loud tone
    return out;
  }

  it('strips leading and trailing silence around speech', () => {
    const trimmed = trimSilence(buffer(500, 400, 650), SR);
    // ~400 ms of voiced audio plus ~80 ms margin each side, far less than the
    // original ~1550 ms — and nowhere near the full buffer.
    expect(trimmed.length).toBeGreaterThan(SR * 0.3);
    expect(trimmed.length).toBeLessThan(SR * 0.8);
  });

  it('returns empty for a fully silent buffer', () => {
    expect(trimSilence(new Float32Array(SR), SR).length).toBe(0);
  });

  it('passes an empty buffer through', () => {
    expect(trimSilence(new Float32Array(0), SR).length).toBe(0);
  });
});

describe('collapseRepetitions', () => {
  it('collapses a looped multi-word phrase to a single copy', () => {
    expect(collapseRepetitions('go to the store go to the store go to the store')).toBe('go to the store');
  });

  it('collapses a long single-word run', () => {
    expect(collapseRepetitions('hello yeah yeah yeah yeah yeah yeah there')).toBe('hello yeah there');
  });

  it('leaves natural short emphasis untouched', () => {
    expect(collapseRepetitions('no no no')).toBe('no no no');
    expect(collapseRepetitions('that is very very good')).toBe('that is very very good');
  });

  it('leaves a normal sentence untouched', () => {
    const sentence = 'please open the file explorer and run the tests';
    expect(collapseRepetitions(sentence)).toBe(sentence);
  });

  it('handles empty input', () => {
    expect(collapseRepetitions('')).toBe('');
  });
});
