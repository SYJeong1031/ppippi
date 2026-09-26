import webpush from "web-push";
import { all, run, secret } from "./db";
import { inDnd } from "./shared";
export async function vapid() {
  return JSON.parse(
    await secret("vapid", async () =>
      JSON.stringify(webpush.generateVAPIDKeys()),
    ),
  );
}
export function validEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
        "wns.windows.com",
        "notify.windows.com",
      ].some((h) => u.hostname === h || u.hostname.endsWith("." + h))
    );
  } catch {
    return false;
  }
}
export async function notify(
  userId: string,
  s: any,
  page: any,
  origin: string,
) {
  if (!s.push_notification || inDnd(s)) return;
  const subs = await all(
    "SELECT * FROM push_subscriptions WHERE user_id=? LIMIT 8",
    userId,
  );
  if (!subs.length) return;
  const keys = await vapid();
  await Promise.allSettled(
    subs.map(async (sub) => {
      if (!validEndpoint(sub.endpoint)) return;
      try {
        const details = webpush.generateRequestDetails(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({
            title: "📟 PPI",
            body: s.show_message_in_notification
              ? `${page.numeric_message} · ${page.callback_number}`
              : "새로운 삐삐가 도착했습니다.",
            url: "/",
            tag: page.id,
            silent: !s.sound,
            vibration: !!s.vibration,
          }),
          {
            vapidDetails: {
              subject: origin,
              publicKey: keys.publicKey,
              privateKey: keys.privateKey,
            },
            TTL: 60,
            urgency: "high",
          },
        );
        const res = await fetch(details.endpoint, {
          method: "POST",
          headers: details.headers as Record<string, string>,
          body: details.body as any,
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 404 || res.status === 410)
          await run(
            "DELETE FROM push_subscriptions WHERE endpoint=?",
            sub.endpoint,
          );
        else if (!res.ok) console.error("push delivery rejected", res.status);
      } catch (e) {
        console.error(
          "push delivery failed",
          e instanceof Error ? e.message : "unknown",
        );
      }
    }),
  );
}
