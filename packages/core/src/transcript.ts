/**
 * Кой говори, гледано от собственика на Copilot-а.
 * Определя се от източника на звука (микрофон или таб на срещата),
 * а не чрез разпознаване на глас.
 */
export type SpeakerRole = "owner" | "counterpart";

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  speaker: SpeakerRole;
  text: string;
  /** Милисекунди от началото на срещата. */
  startMs: number;
  endMs: number;
  /** Междинните резултати още могат да се променят. Пазят се само финалните. */
  isFinal: boolean;
  providerId: string;
  /** Часовник (Date.now()) в момента, в който текстът е стигнал до нас. Служи за измерване на закъснението. */
  receivedAt: number;
  /** Часовник в момента, в който говорът е спрял. Закъснение = receivedAt - speechEndedAt. */
  speechEndedAt?: number;
}
