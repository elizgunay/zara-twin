/**
 * Минимален четец на WAV: 16-битов PCM или 32-битов float, произволен брой канали.
 * Каналите се смесват в моно. Записите от Fathom и Windows TTS са в този формат
 * (или се превръщат в него с ffmpeg).
 */
export interface DecodedWav {
  sampleRate: number;
  /** Моно, float в [-1, 1]. */
  samples: Float32Array;
}

export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("Файлът не е WAV (липсва RIFF/WAVE заглавие).");
  }

  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (format === null) throw new Error("WAV: блокът data е преди fmt.");
      const dataSize = Math.min(size, bytes.length - body);
      return { sampleRate: format.sampleRate, samples: readSamples(view, body, dataSize, format) };
    }
    offset = body + size + (size % 2); // блоковете са подравнени на четен байт
  }
  throw new Error("WAV: липсва блок data.");
}

function readSamples(
  view: DataView,
  start: number,
  size: number,
  format: { audioFormat: number; channels: number; bitsPerSample: number },
): Float32Array {
  const { audioFormat, channels, bitsPerSample } = format;
  // 0xFFFE = WAVE_FORMAT_EXTENSIBLE; приемаме го като PCM/float според битовете.
  const isFloat = audioFormat === 3 || (audioFormat === 0xfffe && bitsPerSample === 32);
  const isPcm16 = (audioFormat === 1 || audioFormat === 0xfffe) && bitsPerSample === 16;
  if (!isFloat && !isPcm16) {
    throw new Error(`WAV: поддържат се 16-битов PCM и 32-битов float (тук: формат ${audioFormat}, ${bitsPerSample} бита).`);
  }
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(size / (bytesPerSample * channels));
  const output = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const at = start + (frame * channels + channel) * bytesPerSample;
      sum += isFloat ? view.getFloat32(at, true) : view.getInt16(at, true) / 0x8000;
    }
    output[frame] = sum / channels;
  }
  return output;
}
