/**
 * Разпознаването на говор работи най-добре с 16 kHz моно 16-битов PCM,
 * а браузърът дава 44.1 или 48 kHz float. Тук е преобразуването.
 */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Намалява честотата чрез осредняване на съседните семпли (прост нискочестотен филтър
 * срещу изкривяване) и преобразува [-1, 1] float в Int16 със срязване на пиковете.
 * Worklet-ът подава парчета от 100 ms, затова и при 48 kHz, и при 44.1 kHz
 * броят на изходните семпли е цял и между парчетата не остава остатък.
 */
export function downsampleToInt16(
  input: Float32Array,
  inputRate: number,
  outputRate: number = TARGET_SAMPLE_RATE,
): Int16Array {
  if (outputRate > inputRate) {
    throw new Error(`Не може да се увеличи честотата от ${inputRate} на ${outputRate} Hz.`);
  }
  const ratio = inputRate / outputRate;
  const output = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    const sample = Math.max(-1, Math.min(1, end > start ? sum / (end - start) : 0));
    output[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

/** Средноквадратична сила на звука, от 0 (тишина) до 1. Използва се за индикатора в панела. */
export function rmsLevel(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const value of pcm) {
    const normalized = value / 0x8000;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / pcm.length);
}

/** Обратното преобразуване: моделите (Whisper) очакват float в [-1, 1]. */
export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const output = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) output[i] = pcm[i]! / 0x8000;
  return output;
}
