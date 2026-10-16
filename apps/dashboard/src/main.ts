import type { Session } from "@supabase/supabase-js";
import * as api from "./api";
import { action, h, humanError } from "./dom";
import { ROLE_LABEL, SCREEN_LABEL, screenFromHash, screensFor, type Membership, type Screen } from "./model";
import { catalogScreen, meetingsScreen, memoryScreen, proposalsScreen, settingsScreen, startScreen, type Context } from "./screens";

// Табло на Zara Copilot: вход с връзка по имейл → избор на фирма → екраните според ролята.

const app = document.getElementById("app")!;
let session: Session | null = null;
let memberships: Membership[] = [];
let orgId: string | null = null;

function show(...nodes: Node[]): void {
  app.replaceChildren(...nodes);
}

function shell(title: string, ...body: Node[]): HTMLElement {
  return h("div", { class: "wrap" }, h("header", { class: "top" }, h("div", { class: "meta" }, h("span", { class: "eyebrow" }, "Zara Copilot · Табло"), h("h1", {}, title))), ...body);
}

function notConfigured(): void {
  show(shell("Таблото не е настроено",
    h("section", { class: "panel" }, h("p", {}, "В .env липсват SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY (Publishable key). Виж docs/setup/supabase.md."))));
}

function loginScreen(sent = ""): void {
  const email = h("input", { type: "email", id: "login-email", autocomplete: "email", placeholder: "вашият имейл", required: true }) as HTMLInputElement;
  show(shell("Вход",
    h("section", { class: "panel narrow" },
      h("p", { class: "muted" }, "Без парола: изпращаме ви връзка за вход на имейла. Влизат само поканени хора и създателят на фирмата."),
      h("label", { for: "login-email" }, "Имейл", email),
      action("Изпрати връзка за вход", async () => {
        if (!email.value.includes("@")) throw new Error("Въведете имейл.");
        await api.sendLoginLink(email.value);
        loginScreen(email.value);
      }),
      sent ? h("p", { class: "status ok" }, `Изпратихме връзка на ${sent}. Отворете имейла на този компютър и натиснете връзката.`) : null,
    )));
}

function createOrgScreen(): void {
  const name = h("input", { type: "text", id: "org-name", maxlength: 120, value: "Zara Robotics" }) as HTMLInputElement;
  show(shell("Нова фирма",
    h("section", { class: "panel narrow" },
      h("p", { class: "muted" }, `Влезли сте като ${session?.user.email ?? ""}, но още не сте в никоя фирма. Ако някой ви е поканил, помолете го да провери имейла в поканата. Ако сте собственикът, създайте фирмата си.`),
      h("label", { for: "org-name" }, "Име на фирмата", name),
      h("div", { class: "row" },
        action("Създай фирмата", async () => { await api.createOrg(name.value); await loadMemberships(); }),
        action("Изход", async () => { await api.signOut(); }, "ghost"),
      ),
    )));
}

async function loadMemberships(): Promise<void> {
  if (!session) return loginScreen();
  try {
    memberships = await api.myMemberships(session.user.id);
  } catch (error) {
    show(shell("Грешка", h("section", { class: "panel" }, h("p", { class: "status err" }, humanError(error)))));
    return;
  }
  if (!memberships.length) return createOrgScreen();
  if (!orgId || !memberships.some((m) => m.orgId === orgId)) orgId = memberships[0]!.orgId;
  render();
}

function render(): void {
  const org = memberships.find((m) => m.orgId === orgId);
  if (!session || !org) return void loadMemberships();
  const allowed = screensFor(org.role);
  const screen = screenFromHash(location.hash, allowed);
  const ctx: Context = { org, userId: session.user.id, email: session.user.email ?? "", refresh: () => void loadMemberships() };

  const nav = h("nav", { class: "tabs", "aria-label": "Екрани" },
    ...allowed.map((s) => h("a", { href: `#/${s}`, class: s === screen ? "tab current" : "tab", "aria-current": s === screen ? "page" : undefined }, SCREEN_LABEL[s])));
  const orgPicker = memberships.length > 1
    ? h("select", { id: "org-pick", "aria-label": "Фирма", onchange: (e: Event) => { orgId = (e.target as HTMLSelectElement).value; render(); } },
        ...memberships.map((m) => h("option", { value: m.orgId, selected: m.orgId === org.orgId }, m.orgName)))
    : h("span", { class: "org" }, org.orgName);

  const body: Record<Screen, () => HTMLElement> = {
    start: () => startScreen(ctx),
    proposals: () => proposalsScreen(ctx),
    meetings: () => meetingsScreen(ctx),
    memory: () => memoryScreen(ctx),
    catalog: () => catalogScreen(),
    settings: () => settingsScreen(ctx),
  };

  show(h("div", { class: "wrap" },
    h("header", { class: "top" },
      h("div", { class: "meta" }, h("span", { class: "eyebrow" }, "Zara Copilot · Табло"), h("h1", {}, SCREEN_LABEL[screen])),
      h("div", { class: "who" }, orgPicker, h("span", { class: "chip" }, ROLE_LABEL[org.role]), action("Изход", async () => { await api.signOut(); }, "ghost")),
    ),
    nav,
    body[screen](),
  ));
}

window.addEventListener("hashchange", () => { if (session) render(); });

if (!api.configured || !api.supabase) {
  notConfigured();
} else {
  // Връзката от имейла връща потребителя тук; Supabase сам разчита сесията от адреса.
  api.supabase.auth.onAuthStateChange((_event, next) => {
    const changedUser = next?.user.id !== session?.user.id;
    session = next;
    if (!session) {
      memberships = [];
      orgId = null;
      loginScreen();
    } else if (changedUser) {
      void loadMemberships();
    }
  });
}
