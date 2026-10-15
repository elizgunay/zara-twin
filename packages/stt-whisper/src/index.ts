// Тежката част (transformers.js) е в отделен вход "@zara-twin/stt-whisper/transformers",
// за да може логиката да се ползва и тества без модела.
export { WhisperLocalProvider, type Transcriber, type WhisperProviderOptions } from "./whisperProvider";
export { DEFAULT_SEGMENTER, UtteranceSegmenter, type SegmenterOptions, type Utterance } from "./segmenter";
export { isLikelyHallucination } from "./hallucinations";
