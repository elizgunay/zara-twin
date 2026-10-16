import { productCard, validatePack } from "@zara-twin/knowledge";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import * as api from "./api";
import { action, confirmAction, empty, h, humanError } from "./dom";
import { daysLeft, formatDateTime, groupMemories, isEmail, ROLE_LABEL, type Membership, type Role } from "./model";

// Екраните на таблото. Всеки връща елемент и сам зарежда данните си; refresh() го рисува отново.

export interface Context {
  org: Membership;
  userId: string;
  email: string;
  refresh: () => void;
}

const pack = validatePack(rawPack);

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", { class: "panel" }, h("h2", {}, title), ...children);
}

async function loading(target: HTMLElement, load: () => Promise<Node[]>): Promise<void> {
  target.replaceChildren(empty("Зареждане…"));
  try {
    target.replaceChildren(...(await load()));
  } catch (error) {
    target.replaceChildren(h("p", { class: "status err" }, humanError(error)));
  }
}

// ---------- Начало ----------
export function startScreen(ctx: Context): HTMLElement {
  const root = h("div", { class: "stack" });
  void loading(root, async () => {
    await api.purgeExpired();
    const [n, meetings] = await Promise.all([api.counts(ctx.org.orgId), api.listMeetings(ctx.org.orgId, 5)]);
    const tile = (label: string, value: number, hint: string, href: string) =>
      h("a", { class: "tile", href }, h("span", { class: "eyebrow" }, label), h("span", { class: "value" }, String(value)), h("span", { class: "hint" }, hint));
    return [
      h("div", { class: "tiles" },
        tile("За одобрение", n.proposals, n.proposals ? "Прегледайте ги след срещата" : "Няма чакащи", "#/proposals"),
        tile("Запазени срещи", n.meetings, `Пазят се ${ctx.org.retentionDays} дни`, "#/meetings"),
        tile("Факти в паметта", n.memories, "Copilot ги ползва в подсказките", "#/memory"),
      ),
      section("Последни срещи", meetings.length
        ? h("ul", { class: "list" }, ...meetings.map((m) => h("li", {}, h("span", { class: "mono" }, m.meeting_code), h("span", { class: "muted" }, `${formatDateTime(m.started_at)} · ${m.lines.length} реда`))))
        : empty("Още няма запазени срещи. Те идват от бутона „Запази“ в панела на Copilot (връзката с разширението е следващата стъпка).")),
    ];
  });
  return root;
}

// ---------- За одобрение ----------
export function proposalsScreen(ctx: Context): HTMLElement {
  const root = h("div", { class: "stack" });
  void loading(root, async () => {
    const proposals = await api.listProposals(ctx.org.orgId);
    if (!proposals.length) {
      return [section("За одобрение", empty("Няма чакащи предложения. След всяка запазена среща Copilot ще предлага какво да запомни (стъпка 5), а вие решавате тук."))];
    }
    return [section(`За одобрение (${proposals.length})`, h("ul", { class: "cards" }, ...proposals.map((p) => {
      const subject = h("input", { type: "text", value: p.subject, maxlength: 200, "aria-label": "За кого" }) as HTMLInputElement;
      const fact = h("textarea", { maxlength: 2000, "aria-label": "Факт" }, p.fact) as HTMLTextAreaElement;
      return h("li", { class: "card" },
        h("label", {}, "За кого", subject),
        h("label", {}, "Факт", fact),
        p.quote ? h("blockquote", {}, p.quote) : null,
        h("div", { class: "row" },
          action("Запомни", async () => { await api.approveProposal(ctx.org.orgId, p, ctx.userId, fact.value, subject.value); ctx.refresh(); }),
          action("Не", async () => { await api.rejectProposal(p.id, ctx.userId); ctx.refresh(); }, "ghost"),
        ),
      );
    })))];
  });
  return root;
}

// ---------- Срещи ----------
export function meetingsScreen(ctx: Context): HTMLElement {
  const root = h("div", { class: "stack" });
  void loading(root, async () => {
    const meetings = await api.listMeetings(ctx.org.orgId);
    if (!meetings.length) return [section("Срещи", empty("Още няма запазени срещи."))];
    return [section("Срещи", h("ul", { class: "cards" }, ...meetings.map((m) => {
      const transcript = h("div", { class: "transcript", hidden: true },
        ...m.lines.map((line) => h("p", {}, h("strong", {}, line.speaker === "owner" ? "Вие: " : "Събеседник: "), line.text)));
      const toggle = h("button", { type: "button", class: "ghost" }, "Покажи текста");
      toggle.addEventListener("click", () => {
        transcript.hidden = !transcript.hidden;
        toggle.textContent = transcript.hidden ? "Покажи текста" : "Скрий текста";
      });
      return h("li", { class: "card" },
        h("div", { class: "row spread" },
          h("div", {}, h("strong", { class: "mono" }, m.meeting_code), h("div", { class: "muted" }, `${formatDateTime(m.started_at)} · ${m.lines.length} реда · изтрива се след ${daysLeft(m.saved_at, ctx.org.retentionDays)} дни`)),
          h("div", { class: "row" }, toggle, confirmAction("Изтрий", "Текстът на срещата се изтрива завинаги.", async () => { await api.deleteMeeting(m.id); ctx.refresh(); })),
        ),
        transcript,
      );
    })))];
  });
  return root;
}

// ---------- Памет ----------
export function memoryScreen(ctx: Context): HTMLElement {
  const root = h("div", { class: "stack" });
  const subject = h("input", { type: "text", id: "mem-subject", maxlength: 200, placeholder: "напр. Хотел Марица" }) as HTMLInputElement;
  const fact = h("textarea", { id: "mem-fact", maxlength: 2000, placeholder: "напр. Иска 2 робота T8, решава през март" }) as HTMLTextAreaElement;
  const search = h("input", { type: "search", id: "mem-search", placeholder: "Търсене в паметта" }) as HTMLInputElement;
  const list = h("div", { class: "stack" });
  let rows: Awaited<ReturnType<typeof api.listMemories>> = [];

  const draw = () => {
    const groups = groupMemories(rows, search.value);
    if (!groups.length) {
      list.replaceChildren(empty(rows.length ? "Нищо не отговаря на търсенето." : "Паметта е празна. Добавете първия факт отгоре или одобрете предложение."));
      return;
    }
    list.replaceChildren(...groups.map((group) => h("section", { class: "panel" },
      h("div", { class: "row spread" }, h("h3", {}, group.subject),
        confirmAction("Забрави всичко за това", `Изтрива се всичко запомнено за „${group.subject}“ (GDPR).`, async () => { await api.forgetSubject(ctx.org.orgId, group.subject); ctx.refresh(); })),
      h("ul", { class: "list" }, ...group.items.map((item) => {
        const text = h("span", { class: "fact" }, item.fact);
        const edit = h("button", { type: "button", class: "ghost" }, "Поправи");
        edit.addEventListener("click", () => {
          const input = h("textarea", { maxlength: 2000, "aria-label": "Поправен факт" }, item.fact) as HTMLTextAreaElement;
          text.replaceWith(input);
          edit.replaceWith(action("Запази", async () => { await api.updateMemory(item.id, input.value); ctx.refresh(); }));
        });
        return h("li", {}, text, h("span", { class: "muted" }, formatDateTime(item.approved_at)),
          h("span", { class: "row" }, edit, confirmAction("Изтрий", "Фактът се изтрива от паметта.", async () => { await api.deleteMemory(item.id); ctx.refresh(); })));
      })),
    )));
  };
  search.addEventListener("input", draw);

  root.append(
    section("Добави факт",
      h("p", { class: "muted" }, "Фактите в паметта се показват в подсказките на Copilot в следващите срещи. Пишете само това, което е вярно и полезно."),
      h("label", { for: "mem-subject" }, "За кого (човек или фирма)", subject),
      h("label", { for: "mem-fact" }, "Факт", fact),
      action("Добави в паметта", async () => {
        if (!subject.value.trim() || !fact.value.trim()) throw new Error("Попълнете и двете полета.");
        await api.addMemory(ctx.org.orgId, subject.value, fact.value, ctx.userId);
        ctx.refresh();
      }),
    ),
    h("div", { class: "panel" }, h("label", { for: "mem-search" }, "Търсене", search)),
    list,
  );
  void loading(list, async () => {
    rows = await api.listMemories(ctx.org.orgId);
    draw();
    return [...list.childNodes];
  });
  return root;
}

// ---------- Каталог ----------
export function catalogScreen(): HTMLElement {
  const search = h("input", { type: "search", id: "cat-search", placeholder: "Модел или серия, напр. T8" }) as HTMLInputElement;
  const list = h("div", { class: "grid" });
  const draw = () => {
    const needle = search.value.trim().toLowerCase();
    const products = pack.products.filter((p) => !needle || `${p.name} ${p.code} ${p.category}`.toLowerCase().includes(needle));
    list.replaceChildren(...(products.length ? products.map((p) => {
      const card = productCard(p, 4);
      return h("article", { class: "card" }, h("h3", {}, card.title), h("p", { class: "muted" }, p.category),
        h("ul", { class: "specs" }, ...card.lines.map((line) => h("li", {}, line))));
    }) : [empty("Няма такъв модел в каталога.")]));
  };
  search.addEventListener("input", draw);
  draw();
  return h("div", { class: "stack" },
    section(`Каталог: ${pack.business.name} (${pack.products.length} модела)`,
      h("p", { class: "muted" }, `Това вижда Copilot в срещите. Източник: ${pack.source.retrievedAt}. Промени в каталога засега минават през Claude; редакция оттук е следваща стъпка.`),
      h("label", { for: "cat-search" }, "Търсене", search)),
    list,
  );
}

// ---------- Настройки ----------
export function settingsScreen(ctx: Context): HTMLElement {
  const root = h("div", { class: "stack" });
  const isOwner = ctx.org.role === "owner";

  const retention = h("select", { id: "retention", disabled: !isOwner },
    ...[7, 30, 90].map((d) => h("option", { value: d, selected: d === ctx.org.retentionDays }, `${d} дни`))) as HTMLSelectElement;
  const retentionStatus = h("span", { class: "inline-status", role: "status" });
  retention.addEventListener("change", async () => {
    try {
      await api.setRetention(ctx.org.orgId, Number(retention.value));
      retentionStatus.textContent = "Запазено.";
      retentionStatus.className = "inline-status ok";
      ctx.refresh();
    } catch (error) {
      retentionStatus.textContent = humanError(error);
      retentionStatus.className = "inline-status err";
    }
  });

  root.append(section("Пазене на срещите",
    h("p", { class: "muted" }, "Текстът на запазените срещи се изтрива автоматично след срока. Паметта (одобрените факти) остава, докато не я изтриете."),
    h("label", { for: "retention" }, "Пази текста на срещите", retention), retentionStatus));

  if (isOwner) {
    const people = h("div", { class: "stack" });
    const email = h("input", { type: "email", id: "invite-email", placeholder: "колега@zararobotics.com", autocomplete: "off" }) as HTMLInputElement;
    const role = h("select", { id: "invite-role" },
      ...(["catalog_editor", "support", "owner"] as Role[]).map((r) => h("option", { value: r }, ROLE_LABEL[r]))) as HTMLSelectElement;
    root.append(section("Хора и роли",
      h("p", { class: "muted" }, "Поканеният влиза с връзка по имейл на същия адрес. Редакторът на каталога и поддръжката не виждат срещите и паметта."),
      people,
      h("div", { class: "row wrap" },
        h("label", { for: "invite-email" }, "Имейл", email),
        h("label", { for: "invite-role" }, "Роля", role),
        action("Покани", async () => {
          if (!isEmail(email.value)) throw new Error("Въведете валиден имейл.");
          await api.invite(ctx.org.orgId, email.value, role.value as Role, ctx.userId);
          ctx.refresh();
        }),
      ),
    ));
    void loading(people, async () => {
      const [members, invitations] = await Promise.all([api.listMembers(ctx.org.orgId), api.listInvitations(ctx.org.orgId)]);
      return [
        h("ul", { class: "list" }, ...members.map((m) => h("li", {},
          h("span", {}, m.user_id === ctx.userId ? `Вие (${ctx.email})` : `Член от ${formatDateTime(m.created_at)}`),
          h("span", { class: "chip" }, ROLE_LABEL[m.role]),
          m.user_id === ctx.userId ? null : confirmAction("Махни", "Човекът губи достъп до таблото.", async () => { await api.removeMember(ctx.org.orgId, m.user_id); ctx.refresh(); }),
        ))),
        invitations.length
          ? h("ul", { class: "list" }, ...invitations.map((i) => h("li", {}, h("span", {}, `Покана: ${i.email}`), h("span", { class: "chip" }, ROLE_LABEL[i.role]),
              action("Отмени", async () => { await api.cancelInvitation(i.id); ctx.refresh(); }, "ghost"))))
          : null,
      ].filter((n): n is HTMLElement => n !== null);
    });
  }
  return root;
}
