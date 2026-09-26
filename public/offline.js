const calls = document.getElementById("calls"),
  owner = document.getElementById("owner");
const req = indexedDB.open("ppi-offline", 1);
req.onupgradeneeded = () => req.result.createObjectStore("cache");
req.onerror = () => {
  calls.textContent = "저장된 호출을 열 수 없습니다.";
};
req.onsuccess = () => {
  const db = req.result;
  const get = db.transaction("cache").objectStore("cache").get("snapshot");
  get.onsuccess = () => {
    const data = get.result;
    calls.replaceChildren();
    if (!data) {
      calls.textContent = "이 기기에 저장된 호출이 없습니다.";
      return;
    }
    owner.textContent =
      data.user.username +
      "님의 최근 호출 · " +
      new Date(data.saved_at).toLocaleString("ko-KR") +
      " 저장";
    if (!data.pages.length) calls.textContent = "아직 받은 호출이 없습니다.";
    for (const page of data.pages) {
      const article = document.createElement("article"),
        num = document.createElement("b"),
        meaning = document.createElement("p"),
        callback = document.createElement("span"),
        time = document.createElement("time");
      num.textContent = page.numeric_message;
      const code = [...data.codes]
        .sort((a, b) => Number(!!b.user_id) - Number(!!a.user_id))
        .find((c) => c.number === page.numeric_message);
      meaning.textContent = data.settings.auto_decode
        ? code?.meaning || ""
        : "";
      callback.textContent = page.callback_number;
      time.textContent =
        new Date(page.created_at).toLocaleString("ko-KR") +
        " · " +
        (page.read ? "읽음" : "안 읽음");
      article.append(num, meaning, callback, time);
      calls.append(article);
    }
  };
  document.getElementById("clear").onclick = () => {
    const tx = db.transaction("cache", "readwrite");
    tx.objectStore("cache").clear();
    tx.oncomplete = () => {
      owner.textContent = "";
      calls.textContent = "이 기기에 저장된 기록을 지웠습니다.";
    };
  };
};
window.addEventListener("online", () => location.reload());
