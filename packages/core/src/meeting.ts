/**
 * Слой с адаптери за платформи (Р4): ядрото знае само тези типове,
 * а не дали срещата е в Google Meet, Zoom, Teams или по телефона.
 */
export type MeetingPlatform = "google-meet" | "zoom" | "teams" | "phone";

/** "tab" = звукът на срещата (другите участници), "microphone" = собственикът. */
export type AudioSourceKind = "tab" | "microphone";

export interface AudioChunk {
  source: AudioSourceKind;
  /** 16-битов PCM, моно. */
  pcm: Int16Array;
  sampleRate: number;
  /** Date.now() в момента на прихващане. */
  capturedAt: number;
}

export interface MeetingInfo {
  id: string;
  platform: MeetingPlatform;
  title?: string;
  startedAt: number;
  /** Използва се за определяне на бизнес профила (Р21), напр. по имейл домейн. */
  participantEmails?: string[];
}

export type Unsubscribe = () => void;

export interface MeetingAdapter {
  readonly platform: MeetingPlatform;
  /** Връща информация за текущата среща или null, ако няма активна среща. */
  currentMeeting(): MeetingInfo | null;
  /** Започва прихващане на звука. Задължително след видимо уведомяване на участниците. */
  startCapture(onAudio: (chunk: AudioChunk) => void): Promise<Unsubscribe>;
}
