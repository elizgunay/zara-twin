// Малък помощник за DOM. Текстът винаги минава през textContent, никога като HTML:
// в паметта и срещите има думи на други хора (непроверен вход).

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | number | ((event: Event) => void) | undefined>;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") element.addEventListener(key.replace(/^on/, ""), value);
    else if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

/** Бутон, който се изключва, докато действието тече, и показва грешката до себе си. */
export function action(label: string, run: () => Promise<void>, kind = "primary"): HTMLElement {
  const status = h("span", { class: "inline-status", role: "status" });
  const button = h("button", { type: "button", class: kind }, label) as HTMLButtonElement;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "";
    try {
      await run();
    } catch (error) {
      status.textContent = humanError(error);
      status.className = "inline-status err";
    } finally {
      button.disabled = false;
    }
  });
  return h("span", { class: "action" }, button, status);
}

/** Потвърждение в самата страница (браузърното confirm() не се ползва). */
export function confirmAction(label: string, question: string, run: () => Promise<void>): HTMLElement {
  const box = h("span", { class: "action" });
  const ask = h("button", { type: "button", class: "ghost danger" }, label);
  ask.addEventListener("click", () => {
    box.replaceChildren(
      h("span", { class: "confirm-q" }, question),
      action("Да, изтрий", run, "danger"),
      h("button", { type: "button", class: "ghost", onclick: () => box.replaceChildren(ask) }, "Отказ"),
    );
  });
  box.append(ask);
  return box;
}

export function humanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/row-level security|permission denied/i.test(message)) return "Нямате права за това действие.";
  if (/duplicate key|already exists/i.test(message)) return "Това вече съществува.";
  if (/Failed to fetch|NetworkError/i.test(message)) return "Няма връзка с базата. Проверете интернета.";
  return message;
}

export function empty(text: string): HTMLElement {
  return h("p", { class: "empty" }, text);
}
