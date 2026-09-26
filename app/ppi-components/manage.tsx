"use client";
import { useState } from "react";
import { BookUser, Plus, Send, Trash2, Hash } from "lucide-react";
import { formatPager } from "@/lib/ppi/shared";
export type Mutate = (
  path: string,
  method: string,
  data?: any,
  message?: string,
) => Promise<boolean>;
export function Contacts({
  contacts,
  mutate,
  onCall,
  busy,
}: {
  contacts: any[];
  mutate: Mutate;
  onCall: (n: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(""),
    [number, setNumber] = useState("");
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">PEOPLE YOU PAGE</span>
          <h2>
            연락처 <small>{contacts.length}</small>
          </h2>
        </div>
        <BookUser size={24} />
      </div>
      <form
        className="form-stack compact-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await mutate(
              "contacts",
              "POST",
              { nickname: name, pager_number: number },
              "연락처를 저장했습니다.",
            )
          ) {
            setName("");
            setNumber("");
          }
        }}
      >
        <label>
          이름
          <input
            aria-label="연락처 이름"
            required
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="어떻게 부를까요?"
          />
        </label>
        <label>
          삐삐 번호
          <input
            aria-label="연락처 삐삐 번호"
            required
            inputMode="numeric"
            maxLength={13}
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^\d-]/g, ""))}
            placeholder="015-0000-0000"
          />
        </label>
        <button className="secondary" disabled={busy}>
          <Plus size={16} />
          연락처 저장
        </button>
      </form>
      {!contacts.length && (
        <div className="empty-state">
          <BookUser size={30} />
          <h3>자주 부르고 싶은 사람.</h3>
          <p>삐삐 번호를 저장해 두면 더 빠르게 호출할 수 있어요.</p>
        </div>
      )}
      <div className="manage-list">
        {contacts.map((c) => (
          <div className="manage-row" key={c.id}>
            <button
              className="contact-main"
              onClick={() => onCall(c.pager_number)}
            >
              <span className="avatar">{c.nickname.slice(0, 1)}</span>
              <span>
                <b>{c.nickname}</b>
                <small>{formatPager(c.pager_number)}</small>
              </span>
              <Send size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={c.nickname + " 연락처 삭제"}
              disabled={busy}
              onClick={() =>
                void mutate(
                  "contacts/" + c.id,
                  "DELETE",
                  {},
                  "연락처를 삭제했습니다.",
                )
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
export function Codes({
  codes,
  mutate,
  busy,
}: {
  codes: any[];
  mutate: Mutate;
  busy: boolean;
}) {
  const [number, setNumber] = useState(""),
    [meaning, setMeaning] = useState("");
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">OUR SECRET LANGUAGE</span>
          <h2>나만의 숫자 암호</h2>
        </div>
        <Hash size={24} />
      </div>
      <p className="muted-text">
        같은 숫자도 나에게는 다른 의미.
        <br />내 암호가 기본 암호보다 먼저 표시됩니다.
      </p>
      <form
        className="form-stack compact-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await mutate(
              "codes",
              "POST",
              { number, meaning },
              "개인 암호를 저장했습니다.",
            )
          ) {
            setNumber("");
            setMeaning("");
          }
        }}
      >
        <div className="two-inputs">
          <label>
            숫자
            <input
              aria-label="개인 암호 숫자"
              inputMode="numeric"
              required
              maxLength={32}
              placeholder="777"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <label>
            나에게는 이런 뜻
            <input
              aria-label="개인 암호 뜻"
              required
              maxLength={80}
              placeholder="집 도착"
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
            />
          </label>
        </div>
        <button className="secondary" disabled={busy}>
          <Plus size={16} />
          암호 저장
        </button>
      </form>
      <div className="manage-list">
        {[...codes]
          .sort((a, b) => Number(!!b.user_id) - Number(!!a.user_id))
          .map((c) => (
            <div className="code-row" key={c.id}>
              <b>{c.number}</b>
              <span>
                {c.meaning}
                <small>
                  {c.user_id ? "개인 암호" : "기본 암호 · 통용되는 뜻"}
                </small>
              </span>
              {c.user_id && (
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={c.number + " 암호 삭제"}
                  onClick={() =>
                    void mutate(
                      "codes/" + c.id,
                      "DELETE",
                      {},
                      "암호를 삭제했습니다.",
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
      </div>
      <p className="fineprint">
        숫자 암호는 공식 표준이 아니며, 사람마다 다르게 사용할 수 있어요.
      </p>
    </section>
  );
}
