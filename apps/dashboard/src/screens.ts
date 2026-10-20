import { productCard, validatePack } from "@zara-twin/knowledge";
import rawPack from "../../../knowledge-packs/zara-robotics/pack.json";
import * as api from "./api";
import { action, confirmAction, empty, h, humanError } from "./dom";
import { daysLeft, formatDateTime, groupMemories, isEmail, ROLE_LABEL, type Membership, type Role } from "./model";
import { duration, filterReports, objectionCounts, offset, scoreTone, sellerLabels, stats, weeklyScores, type ReportKind, type ReportRow } from "./reports";

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
    const [n, reports] = await Promise.all([api.counts(ctx.org.orgId), api.listReports(ctx.org.orgId)]);
    const month = stats(filterReports(reports, 30, null, "real"));
    const tests = filterReports(reports, 30, null, "test").length;
    const tile = (label: string, value: string, hint: string, href: string) =>
      h("a", { class: "tile", href }, h("span", { class: "eyebrow" }, label), h("span", { class: "value" }, value), h("span", { class: "hint" }, hint));
    return [
      h("div", { class: "tiles" },
        tile("Срещи (30 дни)", String(month.count),
          `${month.avgScore === null ? "Още няма реални срещи" : `Средна оценка ${month.avgScore.toFixed(1).replace(".", ",")}/10`}${tests ? ` · ${tests} тестови` : ""}`, "#/meetings"),
        tile("С уговорен час", month.count ? `${month.withNextStep}/${month.count}` : "–", "Срещи, завършили с ден и час", "#/meetings"),
        tile("За одобрение", String(n.proposals), n.proposals ? "Прегледайте ги след срещата" : "Няма чакащи", "#/proposals"),
        tile("Факти в паметта", String(n.memories), "Copilot ги ползва в подсказките", "#/memory"),
      ),
      section("Последни срещи", reports.length
        ? h("ul", { class: "list" }, ...reports.slice(0, 5).map((r) => h("li", {},
            h("span", { class: `score ${scoreTone(r.score)}` }, `${r.score}/10`),
            h("span", {}, formatDateTime(r.started_at)),
            r.is_test ? h("span", { class: "chip test" }, "Тест") : null,
            h("span", { class: "muted" }, r.next_step ? `✓ ${r.next_step.label}` : "✕ без уговорен час"))))
        : empty("Още няма срещи. Те идват от разширението: Опции → Табло → вход с имейл и парола.")),
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
const PERIODS = [7, 30, 90, 365];

export function meetingsScreen(ctx: Context): HTMLElement {
  const isOwner = ctx.org.role === "owner";
  const period = h("select", { id: "rep-period" },
    ...PERIODS.map((d) => h("option", { value: d, selected: d === 30 }, d === 365 ? "Последната година" : `Последните ${d} дни`))) as HTMLSelectElement;
  const seller = h("select", { id: "rep-seller" }, h("option", { value: "" }, "Всички")) as HTMLSelectElement;
  const kind = h("select", { id: "rep-kind" },
    h("option", { value: "all" }, "Всички"), h("option", { value: "real" }, "Само реалните"), h("option", { value: "test" }, "Само тестовите")) as HTMLSelectElement;
  const body = h("div", { class: "stack" });
  let all: ReportRow[] = [];
  let labels = new Map<string, string>();

  const draw = () => {
    const rows = filterReports(all, Number(period.value), seller.value || null, kind.value as ReportKind);
    if (!rows.length) {
      body.replaceChildren(section("Няма срещи за периода",
        h("p", { class: "muted" }, "Срещите идват от разширението след всяка среща (без бутона „Тест“). В разширението: Опции → Табло → вход с имейл и парола.")));
      return;
    }
    body.replaceChildren(reportTiles(rows), reportCharts(rows), reportList(rows, ctx, isOwner ? labels : null));
  };
  period.addEventListener("change", draw);
  seller.addEventListener("change", draw);
  kind.addEventListener("change", draw);

  const filters = h("div", { class: "row wrap" },
    h("label", { for: "rep-period" }, "Период", period),
    h("label", { for: "rep-kind" }, "Вид", kind),
    isOwner ? h("label", { for: "rep-seller" }, "Продавач", seller) : null);
  const root = h("div", { class: "stack" },
    section("Срещи",
      h("p", { class: "muted" }, isOwner
        ? "Обобщението на всяка среща от Copilot: оценка, възражения, роботи, уговорен час. Без текста на разговора. Виждате срещите на целия екип."
        : "Обобщението на вашите срещи от Copilot. Без текста на разговора. Виждате само своите срещи."),
      filters),
    body);

  void loading(body, async () => {
    await api.purgeExpiredReports().catch(() => {});
    all = await api.listReports(ctx.org.orgId);
    labels = sellerLabels(all, ctx.userId);
    seller.replaceChildren(h("option", { value: "" }, "Всички"),
      ...[...labels.entries()].filter(([id]) => all.some((r) => r.user_id === id)).map(([id, label]) => h("option", { value: id }, label)));
    draw();
    return [...body.childNodes];
  });
  if (isOwner) root.append(transcriptsSection(ctx));
  return root;
}

export function reportTiles(rows: ReportRow[]): HTMLElement {
  const s = stats(rows);
  const tile = (label: string, value: string, hint: string) =>
    h("div", { class: "tile" }, h("span", { class: "eyebrow" }, label), h("span", { class: "value" }, value), h("span", { class: "hint" }, hint));
  const pct = (n: number) => `${Math.round((n / s.count) * 100)}%`;
  return h("div", { class: "tiles" },
    tile("Срещи", String(s.count), "за избрания период"),
    tile("Средна оценка", s.avgScore === null ? "–" : `${s.avgScore.toFixed(1).replace(".", ",")}/10`, "по правилата на Copilot"),
    tile("С уговорен час", pct(s.withNextStep), `${s.withNextStep} от ${s.count} срещи`),
    tile("„Ще си помисля“", String(s.thinkMeetings), `${s.thinkMeetings === 1 ? "среща" : "срещи"} с това възражение`),
    tile("Говорене", s.avgOwnerShare === null ? "–" : `${Math.round(s.avgOwnerShare * 100)}%`, "средно говорите вие (добре е под 65%)"),
  );
}

export function reportCharts(rows: ReportRow[]): HTMLElement {
  // Оценка по седмици: височината е оценката от 10; числото е винаги изписано.
  const weeks = weeklyScores(rows);
  const columns = weeks.map((w) => {
    const bar = h("div", { class: `bar ${scoreTone(Math.round(w.avg))}` });
    bar.style.height = `${(w.avg / 10) * 100}%`;
    const [, month, day] = w.week.split("-");
    return h("div", { class: "col", title: `${w.count} ${w.count === 1 ? "среща" : "срещи"}` },
      h("span", { class: "col-value" }, w.avg.toFixed(1).replace(".", ",")),
      h("div", { class: "col-track" }, bar),
      h("span", { class: "col-label" }, `${Number(day)}.${month}`));
  });
  const objections = objectionCounts(rows);
  const max = Math.max(1, ...objections.map((o) => o.count));
  return h("div", { class: "charts" },
    section("Оценка по седмици",
      weeks.length > 1 ? h("div", { class: "columns", role: "img", "aria-label": weeks.map((w) => `седмица от ${w.week}: ${w.avg.toFixed(1)}`).join("; ") }, ...columns)
        : empty("Графиката се появява, когато има срещи в поне две седмици."),
    ),
    section("Най-чести възражения",
      objections.length ? h("ul", { class: "hbars" }, ...objections.map((o) => {
        const fill = h("div", { class: `hbar-fill ${o.id === "think" ? "think" : ""}` });
        fill.style.width = `${(o.count / max) * 100}%`;
        return h("li", {},
          h("div", { class: "row spread" }, h("span", {}, o.label), h("span", { class: "mono" }, `${o.count} пъти · ${o.meetings} ${o.meetings === 1 ? "среща" : "срещи"}`)),
          h("div", { class: "hbar" }, fill));
      })) : empty("Няма възражения в този период."),
    ),
  );
}

export function reportList(rows: ReportRow[], ctx: Context, labels: Map<string, string> | null): HTMLElement {
  return section("Всички срещи", h("ul", { class: "cards" }, ...rows.map((r) => {
    const objections = [...new Set(r.objections.map((o) => o.label))];
    const total = r.owner_ms + r.counterpart_ms;
    const owner = total > 0 ? Math.round((r.owner_ms / total) * 100) : null;
    const details = h("details", { class: "report" },
      h("summary", {},
        h("span", { class: `score ${scoreTone(r.score)}` }, `${r.score}/10`),
        h("span", {}, `${formatDateTime(r.started_at)} · ${duration(r.started_at, r.ended_at)}${labels ? ` · ${labels.get(r.user_id) ?? "Продавач"}` : ""}`),
        r.is_test ? h("span", { class: "chip test" }, "Тест") : null,
        h("span", { class: "muted tagline" }, [r.next_step ? `✓ ${r.next_step.label}` : "✕ без уговорен час", ...objections].join(" · "))),
      h("div", { class: "report-body" },
        r.notes.length ? h("ul", { class: "notes" }, ...r.notes.map((n) => h("li", {}, n))) : null,
        r.objections.length ? h("div", {}, h("h3", {}, "Възражения"),
          h("ul", { class: "notes" }, ...r.objections.map((o) => h("li", {}, h("span", { class: "mono" }, offset(o.atMs)), ` ${o.label}${o.again ? " (пак)" : ""}`)))) : null,
        r.products.length ? h("p", {}, h("strong", {}, "Роботи: "), r.products.join(", ")) : null,
        owner !== null ? h("p", {}, h("strong", {}, "Говорене: "), `Вие ${owner}% · Клиент ${100 - owner}%`) : null,
        conversation(r, ctx.org.retentionDays),
        h("div", { class: "row spread" },
          h("span", { class: "muted mono" }, `${r.meeting_code} · ${r.hints} подсказки`),
          confirmAction("Изтрий", "Обобщението на срещата се изтрива от таблото.", async () => { await api.deleteReport(r.id); ctx.refresh(); })),
      ));
    return h("li", { class: "card" }, details);
  })));
}

/** Текстът на разговора, скрит до натискане. Текстът е непроверен вход: само чрез textContent (h). */
function conversation(r: ReportRow, retentionDays: number): HTMLElement {
  const lines = r.lines ?? [];
  if (!lines.length) {
    return h("p", { class: "muted" }, `Текст на разговора: няма (пази се ${retentionDays} дни след срещата).`);
  }
  const start = new Date(r.started_at).getTime();
  const box = h("div", { class: "transcript", hidden: true },
    ...lines.map((line) => h("p", {},
      h("span", { class: "mono muted" }, `${offset(line.at - start)} `),
      h("strong", {}, line.speaker === "owner" ? "Вие: " : "Клиент: "), line.text)));
  const toggle = h("button", { type: "button", class: "ghost" }, `Покажи разговора (${lines.length} реда)`);
  toggle.addEventListener("click", () => {
    box.hidden = !box.hidden;
    toggle.textContent = box.hidden ? `Покажи разговора (${lines.length} реда)` : "Скрий разговора";
  });
  return h("div", { class: "stack" }, h("div", { class: "row" }, toggle), box);
}

/** Старите записани разговори (бутон „Запази“): показват се само ако има такива. */
function transcriptsSection(ctx: Context): HTMLElement {
  const root = h("div", { class: "stack" });
  void loading(root, async () => {
    const meetings = await api.listMeetings(ctx.org.orgId);
    if (!meetings.length) return [];
    return [section("Записани разговори", h("ul", { class: "cards" }, ...meetings.map((m) => {
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
    h("p", { class: "muted" }, "Текстът на разговорите се изтрива автоматично след срока. Обобщението на срещата (оценка, възражения, роботи) остава една година. Паметта (одобрените факти) остава, докато не я изтриете."),
    h("label", { for: "retention" }, "Пази текста на срещите", retention), retentionStatus));

  if (isOwner) {
    const people = h("div", { class: "stack" });
    // Новата парола се показва тук веднъж: собственикът я копира и я дава на колегата лично.
    const secret = h("div", { class: "stack" });
    const showPassword = (result: api.NewPassword, title: string) => {
      const value = h("code", { class: "secret" }, result.password);
      const copy = h("button", { type: "button", class: "ghost" }, "Копирай");
      copy.addEventListener("click", () => {
        void navigator.clipboard.writeText(`${result.email}\n${result.password}`).then(() => (copy.textContent = "Копирано"), () => (copy.textContent = "Маркирайте и копирайте"));
      });
      secret.replaceChildren(h("div", { class: "card created" },
        h("strong", {}, title),
        h("p", {}, `Имейл: ${result.email}`),
        h("div", { class: "row" }, h("span", {}, "Парола:"), value, copy),
        h("p", { class: "muted" }, "Паролата се показва само сега. Дайте я на колегата лично (не в общ чат), заедно с адреса на таблото. За Copilot: Опции → Табло → същите имейл и парола."),
        h("button", { type: "button", class: "ghost", onclick: () => secret.replaceChildren() }, "Готово, скрий")));
    };

    const email = h("input", { type: "email", id: "invite-email", placeholder: "колега@zararobotics.com", autocomplete: "off" }) as HTMLInputElement;
    const role = h("select", { id: "invite-role" },
      ...(["seller", "catalog_editor", "support", "owner"] as Role[]).map((r) => h("option", { value: r }, ROLE_LABEL[r]))) as HTMLSelectElement;
    root.append(section("Хора и роли",
      h("p", { class: "muted" }, "Създайте потребител тук: акаунтът получава парола, която давате на колегата. Имейл не се праща. Продавачът вижда само своите срещи; редакторът на каталога и поддръжката не виждат срещите и паметта; собственикът вижда и управлява всичко."),
      people,
      secret,
      h("div", { class: "row wrap" },
        h("label", { for: "invite-email" }, "Имейл", email),
        h("label", { for: "invite-role" }, "Роля", role),
        action("Създай потребител", async () => {
          if (!isEmail(email.value)) throw new Error("Въведете валиден имейл.");
          const result = await api.createPerson(ctx.org.orgId, email.value, role.value as Role);
          email.value = "";
          showPassword(result, result.existed ? "Акаунтът вече съществуваше: добавен е във фирмата с нова парола." : "Потребителят е създаден.");
          void reloadPeople();
        }),
      ),
    ));

    const reloadPeople = () => loading(people, async () => {
      const invitations = await api.listInvitations(ctx.org.orgId);
      // Списъкът с имейлите идва от функцията на сървъра; без нея: старият списък без имейли.
      let rows: { userId: string; label: string; role: Role }[];
      let note: HTMLElement | null = null;
      try {
        rows = (await api.listPeople(ctx.org.orgId)).map((p) => ({ userId: p.userId, label: p.userId === ctx.userId ? `Вие (${p.email ?? ctx.email})` : p.email ?? "без имейл", role: p.role }));
      } catch (error) {
        note = h("p", { class: "status err" }, humanError(error));
        rows = (await api.listMembers(ctx.org.orgId)).map((m) => ({ userId: m.user_id, label: m.user_id === ctx.userId ? `Вие (${ctx.email})` : `Член от ${formatDateTime(m.created_at)}`, role: m.role }));
      }
      return [
        note,
        h("ul", { class: "list" }, ...rows.map((m) => h("li", {},
          h("span", { class: "fact" }, m.label),
          h("span", { class: "chip" }, ROLE_LABEL[m.role]),
          note ? null : action("Нова парола", async () => showPassword(await api.resetPassword(ctx.org.orgId, m.userId), "Новата парола е готова. Старата вече не важи.")  , "ghost"),
          m.userId === ctx.userId ? null : confirmAction("Махни", "Човекът губи достъп до таблото и до записа на срещи в таблото.", async () => { await api.removeMember(ctx.org.orgId, m.userId); ctx.refresh(); }),
        ))),
        invitations.length
          ? h("div", { class: "stack" }, h("p", { class: "muted" }, "Стари покани (без акаунт). Създайте потребителя отгоре или отменете поканата."),
              h("ul", { class: "list" }, ...invitations.map((i) => h("li", {}, h("span", { class: "fact" }, `Покана: ${i.email}`), h("span", { class: "chip" }, ROLE_LABEL[i.role]),
                action("Отмени", async () => { await api.cancelInvitation(i.id); ctx.refresh(); }, "ghost")))))
          : null,
      ].filter((n): n is HTMLElement => n !== null);
    });
    void reloadPeople();
  }
  return root;
}
