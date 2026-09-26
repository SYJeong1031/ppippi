import { db, all, one, run } from "@/lib/ppi/db";
import {
  HttpError,
  fail,
  identity,
  member,
  ipKey,
  limit,
  sameOrigin,
  body,
  str,
  digits,
  pager,
  cleanup,
  hash,
} from "@/lib/ppi/security";
import { defaultCodes } from "@/lib/ppi/shared";
import { notify, vapid, validEndpoint } from "@/lib/ppi/push";
export const dynamic = "force-dynamic";
const json = (data: any, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
const publicPages = (user: string) =>
  all(
    "SELECT id,sender_id,receiver_id,callback_number,numeric_message,created_at,read,favorite FROM pages WHERE receiver_id=? ORDER BY created_at DESC,id DESC LIMIT 500",
    user,
  );
async function dictionary(user: string) {
  await db().batch(
    defaultCodes.map((c) =>
      db()
        .prepare(
          "INSERT OR IGNORE INTO codes(id,user_id,number,meaning) VALUES (?,NULL,?,?)",
        )
        .bind("global-" + c.number, c.number, c.meaning),
    ),
  );
  return all("SELECT * FROM codes WHERE user_id=? OR user_id IS NULL", user);
}
async function handle(req: Request) {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.slice(5).split("/");
    const route = parts[0],
      id = parts[1];
    const method = req.method;
    const ip = await ipKey(req);
    if (method !== "GET") sameOrigin(req);
    const input = method !== "GET" ? await body(req) : {};
    await limit("api:" + ip, 180, 60);
    if (route === "me" && method === "GET") {
      const auth = await identity();
      if (!auth) return json({ user: null, identity: null });
      const user = await one("SELECT * FROM users WHERE id=?", auth.userId);
      if (!user)
        return json({
          user: null,
          identity: { name: auth.fullName || "", signedIn: true },
        });
      const [settings, codes, pages, contacts, blocks] = await Promise.all([
        one("SELECT * FROM settings WHERE user_id=?", user.id),
        dictionary(user.id),
        publicPages(user.id),
        all(
          "SELECT c.*,u.pager_number,u.status,u.status_public FROM contacts c JOIN users u ON u.id=c.contact_user_id WHERE c.owner_id=? ORDER BY c.nickname",
          user.id,
        ),
        all(
          "SELECT b.blocked_key,b.blocked_user_id,u.pager_number,b.created_at FROM blocks b LEFT JOIN users u ON u.id=b.blocked_user_id WHERE b.blocker_id=?",
          user.id,
        ),
      ]);
      return json({ user, settings, codes, pages, contacts, blocks });
    }
    if (route === "signup" && method === "POST") {
      const auth = await identity();
      if (!auth) fail(401, "로그인이 필요합니다.");
      await limit("signup:" + ip, 10, 3600);
      const b = input;
      const name = str(b.username, 1, 30, "이름");
      const found = await one("SELECT * FROM users WHERE id=?", auth!.userId);
      if (found) return json({ user: found });
      for (let attempt = 0; attempt < 12; attempt++) {
        const n =
          "015" +
          String(
            crypto.getRandomValues(new Uint32Array(1))[0] % 100000000,
          ).padStart(8, "0");
        try {
          await db().batch([
            db()
              .prepare(
                "INSERT INTO users(id,username,pager_number,created_at) VALUES (?,?,?,?)",
              )
              .bind(auth!.userId, name, n, Date.now()),
            db()
              .prepare("INSERT INTO settings(user_id) VALUES (?)")
              .bind(auth!.userId),
          ]);
          await dictionary(auth!.userId);
          return json(
            { user: await one("SELECT * FROM users WHERE id=?", auth!.userId) },
            201,
          );
        } catch (e) {
          const concurrent = await one(
            "SELECT * FROM users WHERE id=?",
            auth!.userId,
          );
          if (concurrent) return json({ user: concurrent });
          if (!String(e).includes("UNIQUE")) throw e;
        }
      }
      fail(503, "번호 발급이 지연되고 있습니다. 다시 시도해 주세요.");
    }
    if (route === "recipient" && method === "GET") {
      await limit("lookup:" + ip, 12, 60);
      await limit("lookup-day:" + ip, 150, 86400);
      const number = pager(id);
      const target = await one(
        "SELECT u.status,u.status_public,s.receive_from_guests FROM users u JOIN settings s ON s.user_id=u.id WHERE u.pager_number=?",
        number,
      );
      if (!target) fail(404, "번호를 확인해 주세요.");
      return json({
        status: target!.status_public ? target!.status : null,
        receive_from_guests: !!target!.receive_from_guests,
      });
    }
    if (route === "call" && method === "POST") {
      const b = input;
      const number = pager(b.pager_number),
        callback = str(b.callback_number, 3, 24, "회신 번호"),
        message = digits(b.numeric_message, 1, 32, "숫자 메시지"),
        nonce = str(b.request_id, 36, 36, "요청 ID");
      if (
        !/^[\d+ -]+$/.test(callback) ||
        !/^\d{3,20}$/.test(callback.replace(/\D/g, ""))
      )
        fail(400, "올바른 회신 번호를 입력해 주세요.");
      if (!/^[a-f0-9-]{36}$/i.test(nonce))
        fail(400, "요청 ID가 올바르지 않습니다.");
      const auth = await identity();
      const sender = auth
        ? await one("SELECT id FROM users WHERE id=?", auth.userId)
        : null;
      const senderKey = sender ? "user:" + sender.id : "guest:" + ip;
      const requestKey = await hash(senderKey + ":" + nonce);
      const previous = await one(
        "SELECT id FROM pages WHERE request_key=?",
        requestKey,
      );
      if (previous) return json({ ok: true, id: previous.id });
      await limit("send-ip:" + ip, 6, 60);
      await limit("send-day:" + ip, 60, 86400);
      if (sender) await limit("send-user:" + sender.id, 6, 60);
      const receiver = await one(
        "SELECT * FROM users WHERE pager_number=?",
        number,
      );
      if (!receiver)
        fail(404, "호출할 수 없습니다. 번호와 수신 설정을 확인해 주세요.");
      const s = await one(
        "SELECT * FROM settings WHERE user_id=?",
        receiver!.id,
      );
      if (!s?.receive_from_guests && !sender)
        fail(403, "이 삐삐는 가입한 사용자에게만 호출을 받습니다.");
      const blocked = await one(
        "SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_key=?",
        receiver!.id,
        senderKey,
      );
      if (blocked) fail(403, "이 번호로 호출할 수 없습니다.");
      await limit("pair:" + senderKey + ":" + receiver!.id, 1, 10);
      await limit("receiver:" + receiver!.id, 30, 60);
      const page = {
        id: crypto.randomUUID(),
        numeric_message: message,
        callback_number: callback,
      };
      try {
        await db().batch([
          db()
            .prepare(
              "INSERT INTO pages(id,sender_id,sender_key,receiver_id,callback_number,numeric_message,created_at,request_key) VALUES (?,?,?,?,?,?,?,?)",
            )
            .bind(
              page.id,
              sender?.id || null,
              senderKey,
              receiver!.id,
              callback,
              message,
              Date.now(),
              requestKey,
            ),
          db()
            .prepare(
              "UPDATE users SET inbox_version=inbox_version+1 WHERE id=?",
            )
            .bind(receiver!.id),
        ]);
      } catch (e) {
        if (await one("SELECT id FROM pages WHERE request_key=?", requestKey))
          return json({ ok: true });
        throw e;
      }
      await notify(receiver!.id, s, page, url.origin);
      await cleanup();
      return json({ ok: true, id: page.id }, 201);
    }
    const user = await member();
    if (route === "stream" && method === "GET") {
      await limit("stream:" + user.id, 25, 60);
      const enc = new TextEncoder();
      let stopped = false,
        timer: ReturnType<typeof setTimeout>;
      let controller: ReadableStreamDefaultController;
      let lastVersion = -1;
      let ticks = 0;
      const stream = new ReadableStream({
        start(c) {
          controller = c;
          c.enqueue(enc.encode("retry: 3000\n\n"));
          const tick = async () => {
            if (stopped) return;
            try {
              const present = await one(
                "SELECT id,inbox_version FROM users WHERE id=?",
                user.id,
              );
              if (!present) {
                c.enqueue(enc.encode("event: revoked\ndata: {}\n\n"));
                c.close();
                stopped = true;
                return;
              }
              if (present.inbox_version !== lastVersion) {
                const rows = await publicPages(user.id);
                c.enqueue(enc.encode(`data: ${JSON.stringify(rows)}\n\n`));
                lastVersion = present.inbox_version;
              } else c.enqueue(enc.encode(": heartbeat\n\n"));
              if (++ticks >= 10) {
                c.close();
                stopped = true;
                return;
              }
              timer = setTimeout(tick, 3000);
            } catch {
              if (!stopped) {
                c.close();
                stopped = true;
              }
            }
          };
          void tick();
        },
        cancel() {
          stopped = true;
          clearTimeout(timer);
        },
      });
      req.signal.addEventListener(
        "abort",
        () => {
          if (!stopped) {
            stopped = true;
            clearTimeout(timer);
            try {
              controller.close();
            } catch {}
          }
        },
        { once: true },
      );
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (route === "pages" && method === "GET")
      return json(await publicPages(user.id));
    if (route === "pages" && id) {
      const page = await one(
        "SELECT * FROM pages WHERE id=? AND receiver_id=?",
        id,
        user.id,
      );
      if (!page) fail(404, "호출을 찾을 수 없습니다.");
      if (method === "PATCH") {
        const b = input;
        if (typeof b.read !== "boolean" && typeof b.favorite !== "boolean")
          fail(400, "변경할 항목을 선택해 주세요.");
        await db().batch([
          db()
            .prepare(
              "UPDATE pages SET read=COALESCE(?,read),favorite=COALESCE(?,favorite) WHERE id=? AND receiver_id=?",
            )
            .bind(
              typeof b.read === "boolean" ? Number(b.read) : null,
              typeof b.favorite === "boolean" ? Number(b.favorite) : null,
              id,
              user.id,
            ),
          db()
            .prepare(
              "UPDATE users SET inbox_version=inbox_version+1 WHERE id=?",
            )
            .bind(user.id),
        ]);
        return json({ ok: true });
      }
      if (method === "DELETE") {
        await db().batch([
          db()
            .prepare("DELETE FROM pages WHERE id=? AND receiver_id=?")
            .bind(id, user.id),
          db()
            .prepare(
              "UPDATE users SET inbox_version=inbox_version+1 WHERE id=?",
            )
            .bind(user.id),
        ]);
        return json({ ok: true });
      }
    }
    if (route === "settings" && method === "PATCH") {
      const b = input;
      const keys = [
        "sound",
        "vibration",
        "push_notification",
        "show_message_in_notification",
        "auto_decode",
        "dnd_enabled",
        "receive_from_guests",
      ];
      const updates: string[] = [];
      const vals: any[] = [];
      for (const key of keys)
        if (key in b) {
          if (typeof b[key] !== "boolean")
            fail(400, "설정 값이 올바르지 않습니다.");
          updates.push(key + "=?");
          vals.push(Number(b[key]));
        }
      for (const key of ["dnd_start", "dnd_end"])
        if (key in b) {
          if (
            typeof b[key] !== "string" ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(b[key])
          )
            fail(400, "시간 형식을 확인해 주세요.");
          updates.push(key + "=?");
          vals.push(b[key]);
        }
      if ("timezone" in b) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: b.timezone }).format();
        } catch {
          fail(400, "시간대가 올바르지 않습니다.");
        }
        updates.push("timezone=?");
        vals.push(b.timezone);
      }
      if (updates.length)
        await run(
          "UPDATE settings SET " + updates.join(",") + " WHERE user_id=?",
          ...vals,
          user.id,
        );
      return json({ ok: true });
    }
    if (route === "profile" && method === "PATCH") {
      const b = input;
      const name =
        b.username === undefined
          ? user.username
          : str(b.username, 1, 30, "이름");
      const status = b.status === undefined ? user.status : b.status;
      if (!["available", "later", "busy"].includes(status))
        fail(400, "상태를 확인해 주세요.");
      if (b.status_public !== undefined && typeof b.status_public !== "boolean")
        fail(400, "공개 설정이 올바르지 않습니다.");
      await run(
        "UPDATE users SET username=?,status=?,status_public=? WHERE id=?",
        name,
        status,
        b.status_public === undefined
          ? user.status_public
          : Number(b.status_public),
        user.id,
      );
      return json({ ok: true });
    }
    if (route === "contacts") {
      if (method === "POST") {
        await limit("contacts:" + user.id, 20, 60);
        const b = input;
        const nickname = str(b.nickname, 1, 30, "이름"),
          number = pager(b.pager_number);
        const target = await one(
          "SELECT id FROM users WHERE pager_number=?",
          number,
        );
        if (!target) fail(404, "번호를 확인해 주세요.");
        const count = await one(
          "SELECT COUNT(*) AS n FROM contacts WHERE owner_id=?",
          user.id,
        );
        if (count!.n >= 200)
          fail(400, "연락처는 200명까지 저장할 수 있습니다.");
        await run(
          "INSERT INTO contacts(id,owner_id,contact_user_id,nickname) VALUES (?,?,?,?) ON CONFLICT(owner_id,contact_user_id) DO UPDATE SET nickname=excluded.nickname",
          crypto.randomUUID(),
          user.id,
          target!.id,
          nickname,
        );
        return json({ ok: true });
      }
      if (method === "DELETE" && id) {
        await run(
          "DELETE FROM contacts WHERE id=? AND owner_id=?",
          id,
          user.id,
        );
        return json({ ok: true });
      }
    }
    if (route === "codes") {
      if (method === "POST") {
        const b = input;
        const number = digits(b.number, 1, 32, "암호"),
          meaning = str(b.meaning, 1, 80, "뜻");
        const count = await one(
          "SELECT COUNT(*) AS n FROM codes WHERE user_id=?",
          user.id,
        );
        if (count!.n >= 200)
          fail(400, "개인 암호는 200개까지 등록할 수 있습니다.");
        await run(
          "INSERT INTO codes(id,user_id,number,meaning) VALUES (?,?,?,?) ON CONFLICT(user_id,number) DO UPDATE SET meaning=excluded.meaning",
          crypto.randomUUID(),
          user.id,
          number,
          meaning,
        );
        return json({ ok: true });
      }
      if (method === "DELETE" && id) {
        await run("DELETE FROM codes WHERE id=? AND user_id=?", id, user.id);
        return json({ ok: true });
      }
    }
    if (route === "blocks") {
      if (method === "POST") {
        const b = input;
        const page = await one(
          "SELECT sender_id,sender_key FROM pages WHERE id=? AND receiver_id=?",
          str(b.page_id, 1, 80, "호출"),
          user.id,
        );
        if (!page) fail(404, "호출을 찾을 수 없습니다.");
        await run(
          "INSERT OR IGNORE INTO blocks(blocker_id,blocked_user_id,blocked_key,created_at) VALUES (?,?,?,?)",
          user.id,
          page!.sender_id,
          page!.sender_key,
          Date.now(),
        );
        return json({ ok: true });
      }
      if (method === "DELETE") {
        const b = input;
        await run(
          "DELETE FROM blocks WHERE blocker_id=? AND blocked_key=?",
          user.id,
          str(b.blocked_key, 1, 160, "차단 대상"),
        );
        return json({ ok: true });
      }
    }
    if (route === "reports" && method === "POST") {
      await limit("reports:" + user.id, 10, 3600);
      const b = input;
      const page = await one(
        "SELECT id FROM pages WHERE id=? AND receiver_id=?",
        str(b.page_id, 1, 80, "호출"),
        user.id,
      );
      if (!page) fail(404, "호출을 찾을 수 없습니다.");
      await run(
        "INSERT OR IGNORE INTO reports(id,reporter_id,page_id,reason,created_at) VALUES (?,?,?,?,?)",
        crypto.randomUUID(),
        user.id,
        page!.id,
        str(b.reason, 1, 300, "신고 사유"),
        Date.now(),
      );
      return json({ ok: true });
    }
    if (route === "push-key" && method === "GET")
      return json({ publicKey: (await vapid()).publicKey });
    if (route === "push") {
      const b = input;
      if (method === "POST") {
        const endpoint = str(b.endpoint, 10, 2048, "알림 주소");
        if (!validEndpoint(endpoint))
          fail(400, "지원하지 않는 알림 서비스입니다.");
        const p256dh = str(b.keys?.p256dh, 87, 87, "알림 키"),
          auth = str(b.keys?.auth, 22, 24, "알림 키");
        if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_=-]+$/.test(auth))
          fail(400, "알림 키가 올바르지 않습니다.");
        const count = await one(
          "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?",
          user.id,
        );
        if (
          count!.n >= 8 &&
          !(await one(
            "SELECT endpoint FROM push_subscriptions WHERE endpoint=? AND user_id=?",
            endpoint,
            user.id,
          ))
        )
          fail(400, "알림 기기는 최대 8대입니다.");
        await run(
          "INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth",
          endpoint,
          user.id,
          p256dh,
          auth,
        );
        await run(
          "UPDATE settings SET push_notification=1 WHERE user_id=?",
          user.id,
        );
        return json({ ok: true });
      }
      if (method === "DELETE") {
        await run(
          "DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?",
          str(b.endpoint, 10, 2048, "알림 주소"),
          user.id,
        );
        return json({ ok: true });
      }
    }
    if (route === "export" && method === "GET") {
      return json({
        exported_at: new Date().toISOString(),
        user,
        pages: await all(
          "SELECT id,sender_id,receiver_id,callback_number,numeric_message,created_at,read,favorite FROM pages WHERE receiver_id=? ORDER BY created_at DESC",
          user.id,
        ),
        settings: await one("SELECT * FROM settings WHERE user_id=?", user.id),
        contacts: await all(
          "SELECT c.nickname,u.pager_number FROM contacts c JOIN users u ON u.id=c.contact_user_id WHERE c.owner_id=?",
          user.id,
        ),
        codes: await dictionary(user.id),
      });
    }
    if (route === "account" && method === "DELETE") {
      const b = input;
      if (b.confirm !== user.pager_number)
        fail(400, "내 삐삐 번호를 입력해야 삭제할 수 있습니다.");
      await db().batch([
        db()
          .prepare(
            "UPDATE pages SET sender_id=NULL,sender_key='deleted' WHERE sender_id=? AND receiver_id<>?",
          )
          .bind(user.id, user.id),
        db().prepare("DELETE FROM users WHERE id=?").bind(user.id),
      ]);
      return json({ ok: true });
    }
    return json({ error: "요청을 찾을 수 없습니다." }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(
      "PPI request failed",
      e instanceof Error ? e.message : "unknown",
    );
    return json(
      {
        error:
          "잠시 연결할 수 없습니다. 입력한 내용은 그대로 두고 다시 시도해 주세요.",
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
