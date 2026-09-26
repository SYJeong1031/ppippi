export type Page = {
  id: string;
  sender_id: string | null;
  receiver_id: string;
  callback_number: string;
  numeric_message: string;
  created_at: number;
  read: number;
  favorite: number;
};
export type Data = {
  user: any;
  identity?: any;
  settings: any;
  pages: Page[];
  contacts: any[];
  codes: any[];
  blocks: any[];
};
export async function api(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<any> {
  const res = await fetch("/api/" + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result: any = await res.json();
  if (!res.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}
export async function offlineStore(value?: any, clear = false): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ppi-offline", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("cache");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction(
          "cache",
          value !== undefined || clear ? "readwrite" : "readonly",
        ),
        store = tx.objectStore("cache");
      const op = clear
        ? store.clear()
        : value !== undefined
          ? store.put(value, "snapshot")
          : store.get("snapshot");
      let result: any;
      op.onsuccess = () => {
        result = op.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
export async function clearOffline() {
  await offlineStore(undefined, true);
  navigator.serviceWorker?.controller?.postMessage({
    type: "CLEAR_NOTIFICATIONS",
  });
  try {
    await (navigator as any).clearAppBadge?.();
  } catch {}
}
let audio: AudioContext | null = null;
export async function unlockAudio() {
  try {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;
    audio ??= new AudioCtor();
    await audio!.resume();
  } catch {}
}
export function beep() {
  if (!audio || audio.state !== "running") return;
  for (const offset of [0, 0.18, 0.55, 0.73]) {
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = 1800;
    gain.gain.setValueAtTime(0, audio.currentTime + offset);
    gain.gain.linearRampToValueAtTime(0.035, audio.currentTime + offset + 0.01);
    gain.gain.setValueAtTime(0.035, audio.currentTime + offset + 0.09);
    gain.gain.linearRampToValueAtTime(0, audio.currentTime + offset + 0.12);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(audio.currentTime + offset);
    osc.stop(audio.currentTime + offset + 0.13);
  }
}
