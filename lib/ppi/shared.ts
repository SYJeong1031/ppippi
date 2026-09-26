export function inDnd(s: any, now = new Date()): boolean {
  if (!s?.dnd_enabled) return false;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: s.timezone || "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return (
    s.dnd_start === s.dnd_end ||
    (s.dnd_start < s.dnd_end
      ? time >= s.dnd_start && time < s.dnd_end
      : time >= s.dnd_start || time < s.dnd_end)
  );
}
export function formatPager(v: string = "") {
  return v.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
}
export const defaultCodes = [
  { number: "8282", meaning: "빨리빨리" },
  { number: "1004", meaning: "천사" },
  { number: "486", meaning: "사랑해" },
  { number: "7942", meaning: "친구 사이" },
];
export function meaningOf(number: string, codes: any[]) {
  return (
    [...codes]
      .sort((a, b) => Number(!!b.user_id) - Number(!!a.user_id))
      .find((c) => c.number === number)?.meaning || ""
  );
}
