/**
 * Съобщенията между частите на разширението. Всяко входящо съобщение
 * минава през isCopilotMessage, преди да се изпълни.
 */
export type CopilotMessage = { type: "toggle-panel" };

const MESSAGE_TYPES: ReadonlySet<string> = new Set<CopilotMessage["type"]>(["toggle-panel"]);

export function isCopilotMessage(value: unknown): value is CopilotMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    MESSAGE_TYPES.has(value.type)
  );
}
