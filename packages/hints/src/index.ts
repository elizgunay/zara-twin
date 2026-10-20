export { HintEngine, type Hint, type HintEngineOptions, type SegmentInput } from "./engine";
export { ObjectionDetector, type ObjectionOptions } from "./objections";
export { AnswerDetector, type AnswerOptions } from "./answers";
export { MEANING_MODELS, meaningHints, meaningIntents, MeaningIndex, type MeaningModelId, type Embed, type MeaningIntent, type MeaningMatch, type MeaningOptions } from "./meaning";
export { NudgeDetector, type NudgeOptions } from "./nudges";
export { TalkRatioTracker, type TalkRatioOptions, type TalkStats } from "./talkRatio";
export { ScheduleAssistant, type ScheduleAssistantOptions } from "./schedule/scheduleAssistant";
export { parseSchedule, type ScheduleMention } from "./schedule/parseSchedule";
