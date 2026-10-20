import { describe, expect, it } from "vitest";
import { adminKey, generatePassword, handle, type Admin, type Role } from "./index";

const ORG_A = "00000000-0000-4000-8000-00000000a000";
const ORG_B = "00000000-0000-4000-8000-00000000b000";
const OWNER_A = "00000000-0000-4000-8000-0000000000a1";
const SELLER_A = "00000000-0000-4000-8000-0000000000a2";
const OWNER_B = "00000000-0000-4000-8000-0000000000b1";

/** Фалшив Supabase: хора, фирми и роли в паметта. */
function fakeAdmin() {
  const users = new Map<string, string>([[OWNER_A, "owner@a.bg"], [SELLER_A, "seller@a.bg"], [OWNER_B, "owner@b.bg"]]);
  const members = new Map<string, Role>([[`${ORG_A}|${OWNER_A}`, "owner"], [`${ORG_A}|${SELLER_A}`, "seller"], [`${ORG_B}|${OWNER_B}`, "owner"]]);
  const passwords = new Map<string, string>();
  let next = 1;
  const admin: Admin = {
    caller: async (jwt) => (users.has(jwt) ? { id: jwt } : null), // в теста токенът е самото id
    roleIn: async (org, user) => members.get(`${org}|${user}`) ?? null,
    findByEmail: async (email) => {
      for (const [id, e] of users) if (e === email) return { id };
      return null;
    },
    createUser: async (email, password) => {
      const id = `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
      users.set(id, email);
      passwords.set(id, password);
      return { id };
    },
    setPassword: async (id, password) => void passwords.set(id, password),
    addMember: async (org, user, role) => void members.set(`${org}|${user}`, role),
    members: async (org) => [...members].filter(([k]) => k.startsWith(org)).map(([k, role]) => ({ user_id: k.split("|")[1]!, role, created_at: "2026-10-20" })),
    emailOf: async (id) => users.get(id) ?? null,
  };
  return { admin, users, members, passwords };
}

describe("manage-users", () => {
  it("собственикът създава продавач: акаунт, парола, членство", async () => {
    const f = fakeAdmin();
    const r = await handle(OWNER_A, { action: "create", orgId: ORG_A, email: " Ivan@Zara.bg ", role: "seller" }, f.admin, () => "Pass-123");
    expect(r).toEqual({ status: 200, body: { ok: true, email: "ivan@zara.bg", password: "Pass-123", existed: false } });
    const id = [...f.users].find(([, e]) => e === "ivan@zara.bg")![0];
    expect(f.members.get(`${ORG_A}|${id}`)).toBe("seller");
    expect(f.passwords.get(id)).toBe("Pass-123");
  });

  it("продавач, чужд собственик и без вход: отказ", async () => {
    const f = fakeAdmin();
    const body = { action: "create", orgId: ORG_A, email: "x@y.bg", role: "owner" };
    expect((await handle(SELLER_A, body, f.admin)).status).toBe(403);
    expect((await handle(OWNER_B, body, f.admin)).status).toBe(403);
    expect((await handle(null, body, f.admin)).status).toBe(401);
    expect((await handle("непознат", body, f.admin)).status).toBe(401);
    expect(f.users.size).toBe(3);
  });

  it("нова парола само за хора от същата фирма", async () => {
    const f = fakeAdmin();
    const own = await handle(OWNER_A, { action: "reset", orgId: ORG_A, userId: SELLER_A }, f.admin, () => "New-456");
    expect(own.body).toMatchObject({ ok: true, email: "seller@a.bg", password: "New-456" });
    const foreign = await handle(OWNER_A, { action: "reset", orgId: ORG_A, userId: OWNER_B }, f.admin);
    expect(foreign.status).toBe(404);
    expect(f.passwords.has(OWNER_B)).toBe(false);
  });

  it("вече член: не се създава втори път; стар акаунт извън фирмата: добавя се", async () => {
    const f = fakeAdmin();
    expect((await handle(OWNER_A, { action: "create", orgId: ORG_A, email: "seller@a.bg", role: "seller" }, f.admin)).status).toBe(409);
    const r = await handle(OWNER_A, { action: "create", orgId: ORG_A, email: "owner@b.bg", role: "seller" }, f.admin, () => "P");
    expect(r.body).toMatchObject({ ok: true, existed: true });
    expect(f.members.get(`${ORG_A}|${OWNER_B}`)).toBe("seller");
  });

  it("списъкът е само на собствената фирма, с имейлите", async () => {
    const f = fakeAdmin();
    const r = await handle(OWNER_A, { action: "list", orgId: ORG_A }, f.admin);
    expect(r.body).toMatchObject({ ok: true, members: [{ email: "owner@a.bg", role: "owner" }, { email: "seller@a.bg", role: "seller" }] });
  });

  it("невалидни заявки", async () => {
    const f = fakeAdmin();
    for (const body of [null, {}, { action: "create", orgId: ORG_A, email: "без-маймунка", role: "seller" }, { action: "create", orgId: ORG_A, email: "a@b.bg", role: "admin" }, { action: "list", orgId: "1" }]) {
      expect((await handle(OWNER_A, body, f.admin)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("главният ключ: старият или новият формат на Supabase", () => {
    expect(adminKey((n) => ({ SUPABASE_SERVICE_ROLE_KEY: "legacy" })[n])).toBe("legacy");
    expect(adminKey((n) => ({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' })[n])).toBe("sb_secret_x");
    expect(adminKey(() => undefined)).toBeNull();
  });

  it("паролата: 14 знака, без лесни за бъркане символи, различна всеки път", () => {
    const a = generatePassword();
    expect(a).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{14}$/);
    expect(generatePassword()).not.toBe(a);
  });
});
