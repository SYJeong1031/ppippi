import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inDnd } from "../lib/ppi/shared.ts";
const origin = process.env.PPI_TEST_ORIGIN || "http://127.0.0.1:5180";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Tests may only run against a local Worker.");
const prefix = "test-" + randomUUID();
const alice = { id: prefix + "-alice", ip: "192.0.2.11" },
  bob = { id: prefix + "-bob", ip: "192.0.2.12" },
  guest = { ip: "192.0.2.13" };
let pass = 0;
const check = (ok, label) => {
  assert.ok(ok, label);
  console.log("PASS", ++pass, label);
};
async function request(
  actor,
  path,
  method = "GET",
  data,
  expected = 200,
  extra = {},
) {
  const r = await fetch(origin + "/api/" + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "cf-connecting-ip": actor.ip,
      ...(actor.id
        ? {
            "oai-authenticated-user-id": actor.id,
            "oai-authenticated-user-email": actor.id + "@example.test",
          }
        : {}),
      ...extra,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const json = await r.json();
  assert.equal(
    r.status,
    expected,
    `${method} ${path}: ${JSON.stringify(json)}`,
  );
  return json;
}
let a, b;
try {
  a = (
    await request(
      alice,
      "signup",
      "POST",
      { username: "통합 테스트 수신자" },
      201,
    )
  ).user;
  b = (
    await request(
      bob,
      "signup",
      "POST",
      { username: "통합 테스트 발신자" },
      201,
    )
  ).user;
  check(
    a.pager_number !== b.pager_number && /^015\d{8}$/.test(a.pager_number),
    "Unique pager numbers allocated",
  );
  const same = await Promise.all(
    [1, 2, 3].map(() =>
      request(alice, "signup", "POST", { username: "repeat" }),
    ),
  );
  check(
    same.every((x) => x.user.pager_number === a.pager_number),
    "Concurrent repeated signup is idempotent",
  );
  await request(guest, "pages", "GET", undefined, 401);
  check(true, "Guests cannot read private inboxes");
  await request(guest, "settings", "PATCH", { sound: false }, 401);
  check(true, "Guest settings mutation rejected");
  await request(alice, "settings", "PATCH", { sound: false }, 403, {
    Origin: "https://attacker.example",
  });
  check(true, "Cross-origin writes rejected");
  const look = await request(guest, "recipient/" + a.pager_number);
  check(
    look.status === "available" && !("id" in look) && !("username" in look),
    "Public status minimizes data exposure",
  );
  await request(
    bob,
    "call",
    "POST",
    {
      pager_number: a.pager_number,
      callback_number: "010-0000-0000",
      numeric_message: "<script>",
      request_id: randomUUID(),
    },
    400,
  );
  check(true, "Server rejects non-numeric message");
  await request(
    bob,
    "call",
    "POST",
    {
      pager_number: a.pager_number,
      callback_number: "<img src=x>",
      numeric_message: "486",
      request_id: randomUUID(),
    },
    400,
  );
  check(true, "Server rejects invalid callback");
  const abort = new AbortController();
  const stream = await fetch(origin + "/api/stream", {
    headers: {
      "oai-authenticated-user-id": alice.id,
      "oai-authenticated-user-email": "alice@example.test",
      "cf-connecting-ip": alice.ip,
    },
    signal: abort.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /event-stream/);
  const reader = stream.body.getReader();
  let buffer = "";
  async function eventWith(predicate) {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      const next = await Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("SSE deadline")), 12000),
        ),
      ]);
      if (next.done) break;
      buffer += new TextDecoder().decode(next.value);
      let at;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const line = block.split("\n").find((x) => x.startsWith("data: "));
        if (line) {
          const rows = JSON.parse(line.slice(6));
          if (predicate(rows)) return rows;
        }
      }
    }
    throw Error("SSE event missing");
  }
  await eventWith((rows) => Array.isArray(rows));
  const payload = {
    pager_number: a.pager_number,
    callback_number: b.pager_number,
    numeric_message: "486",
    request_id: randomUUID(),
  };
  const sent = await request(bob, "call", "POST", payload, 201);
  check(!!sent.id, "Cross-user call persists");
  const received = await eventWith((rows) =>
    rows.some((p) => p.id === sent.id),
  );
  check(
    received.some((p) => p.numeric_message === "486" && !p.read),
    "SSE delivers new call without reload",
  );
  abort.abort();
  await request(bob, "call", "POST", payload);
  const inbox = await request(alice, "pages");
  check(
    inbox.filter((p) => p.id === sent.id).length === 1,
    "Retry request cannot duplicate a call",
  );
  check(
    (await request(bob, "pages")).length === 0,
    "Inbox is scoped to receiver",
  );
  await request(bob, "pages/" + sent.id, "PATCH", { read: true }, 404);
  await request(bob, "pages/" + sent.id, "DELETE", {}, 404);
  check(true, "Other users cannot update or delete a call");
  await request(alice, "pages/" + sent.id, "PATCH", {
    read: true,
    favorite: true,
  });
  const updated = await request(alice, "pages");
  check(
    updated[0].read === 1 && updated[0].favorite === 1,
    "Read and favorite persisted",
  );
  await request(alice, "codes", "POST", {
    number: "486",
    meaning: "우리만의 뜻",
  });
  const me = await request(alice, "me");
  check(
    me.codes.some((c) => c.user_id === alice.id && c.meaning === "우리만의 뜻"),
    "Private code override saved",
  );
  check(
    !(await request(bob, "me")).codes.some((c) => c.meaning === "우리만의 뜻"),
    "Private code is isolated",
  );
  await request(alice, "contacts", "POST", {
    nickname: "친구",
    pager_number: b.pager_number,
  });
  await request(alice, "contacts", "POST", {
    nickname: "친구 수정",
    pager_number: b.pager_number,
  });
  const contact = (await request(alice, "me")).contacts;
  check(
    contact.length === 1 && contact[0].nickname === "친구 수정",
    "Contact upsert works without duplicates",
  );
  await request(alice, "reports", "POST", {
    page_id: sent.id,
    reason: "통합 테스트",
  });
  check(true, "Report accepted for owned call");
  await request(alice, "blocks", "POST", { page_id: sent.id });
  await request(
    { ...bob, ip: "192.0.2.20" },
    "call",
    "POST",
    { ...payload, request_id: randomUUID() },
    403,
  );
  check(true, "Account block survives sender IP changes");
  await request(alice, "settings", "PATCH", { receive_from_guests: false });
  await request(
    guest,
    "call",
    "POST",
    { ...payload, request_id: randomUUID() },
    403,
  );
  check(true, "Member-only setting blocks guests");
  await request(alice, "settings", "PATCH", {
    receive_from_guests: true,
    auto_decode: false,
    dnd_enabled: true,
    dnd_start: "23:00",
    dnd_end: "07:00",
    timezone: "Asia/Seoul",
  });
  const gsent = await request(
    guest,
    "call",
    "POST",
    { ...payload, numeric_message: "8282", request_id: randomUUID() },
    201,
  );
  check(!!gsent.id, "DND still saves guest call");
  await request(alice, "blocks", "POST", { page_id: gsent.id });
  await request(
    guest,
    "call",
    "POST",
    { ...payload, request_id: randomUUID() },
    403,
  );
  check(true, "Guest network block enforced");
  await request(alice, "settings", "PATCH", { dnd_start: "25:99" }, 400);
  await request(alice, "settings", "PATCH", { timezone: "invalid/zone" }, 400);
  check(true, "Invalid DND times and zones rejected");
  const dnd = {
    dnd_enabled: 1,
    dnd_start: "23:00",
    dnd_end: "07:00",
    timezone: "Asia/Seoul",
  };
  check(
    inDnd(dnd, new Date("2026-09-26T14:00:00Z")) &&
      !inDnd(dnd, new Date("2026-09-26T22:00:00Z")) &&
      inDnd(dnd, new Date("2026-09-26T21:59:00Z")),
    "DND handles midnight and boundary times",
  );
  check(
    inDnd({ ...dnd, dnd_start: "00:00", dnd_end: "00:00" }),
    "Equal DND times mute all day",
  );
  const key = await request(alice, "push-key");
  check(
    typeof key.publicKey === "string" && key.publicKey.length === 87,
    "Worker generates stable VAPID public key",
  );
  check(
    (await request(alice, "push-key")).publicKey === key.publicKey,
    "VAPID key persists across requests",
  );
  await request(
    alice,
    "push",
    "POST",
    {
      endpoint: "https://127.0.0.1/internal",
      keys: { p256dh: "x".repeat(87), auth: "x".repeat(22) },
    },
    400,
  );
  check(true, "Push SSRF endpoint rejected");
  const exp = await request(alice, "export");
  check(
    exp.pages.length === 2 &&
      exp.contacts.length === 1 &&
      !("sender_key" in exp.pages[0]),
    "Export includes owned data without abuse fingerprints",
  );
  await request(alice, "profile", "PATCH", {
    status: "busy",
    status_public: false,
  });
  check(
    (await request(guest, "recipient/" + a.pager_number)).status === null,
    "Hidden status is not leaked",
  );
  const rateActor = { ip: "192.0.2.90" };
  for (let i = 0; i < 12; i++)
    await request(rateActor, "recipient/" + a.pager_number);
  await request(
    rateActor,
    "recipient/" + a.pager_number,
    "GET",
    undefined,
    429,
  );
  check(true, "Enumeration lookup rate limit enforced");
  await request(alice, "pages/" + sent.id, "DELETE", {});
  check(
    !(await request(alice, "pages")).some((p) => p.id === sent.id),
    "Call deletion persists",
  );
  await request(alice, "account", "DELETE", { confirm: "01500000000" }, 400);
  check(true, "Account deletion requires exact pager confirmation");
  const worker = await fetch(origin + "/sw.js");
  check(
    worker.ok && (await worker.text()).includes("showNotification"),
    "Service worker served",
  );
  const manifest = await (await fetch(origin + "/manifest.webmanifest")).json();
  check(
    manifest.display === "standalone" && manifest.icons.length === 2,
    "Installable PWA manifest",
  );
  for (const path of [
    "/icon-192.png",
    "/icon-512.png",
    "/offline.html",
    "/offline.js",
    "/offline.css",
  ])
    assert.equal((await fetch(origin + path)).status, 200);
  check(true, "All offline-shell assets served");
  console.log(`\n${pass} integration assertions passed.`);
} finally {
  if (a) await request(alice, "account", "DELETE", { confirm: a.pager_number });
  if (b) await request(bob, "account", "DELETE", { confirm: b.pager_number });
  if (a) assert.equal((await request(alice, "me")).user, null);
  if (b) assert.equal((await request(bob, "me")).user, null);
  console.log("Temporary test accounts and owned data removed.");
}
