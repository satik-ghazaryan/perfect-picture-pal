import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { MessageCircle, X } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

const STAFF_PATH = /^\/(admin|guide|driver|login)(\/|$)/;

function pageTourId(pathname: string) {
  const match = /^\/tours\/([a-z0-9-]{1,64})$/.exec(pathname);
  return match?.[1] ?? "";
}

export function TourChat() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tourId = pageTourId(pathname);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const intro = tourId
    ? "Հարցրեք այս տուրի գնի, հաջորդ մեկնման, ժամի կամ ազատ տեղերի մասին։ Ամրագրում չեմ կատարում։"
    : "Հարցրեք տուրի գնի, հաջորդ մեկնման կամ ազատ տեղերի մասին։ Եթե տուրը չլինի պարզ, կհարցնեմ։";
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  if (STAFF_PATH.test(pathname)) return null;

  async function send() {
    const message = draft.trim();
    if (!message || pending) return;
    const history = [{ role: "assistant" as const, text: intro }, ...messages].slice(-6);
    setDraft("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setPending(true);
    try {
      const response = await fetch("/api/tour-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, tourId, history }),
      });
      const payload = (await response.json()) as { reply?: string; error?: string };
      const text =
        payload.reply ||
        payload.error ||
        "Չաթը հիմա չպատասխանեց։ Կարող եք շարունակել ամրագրումը տուրի էջում։";
      setMessages((current) => [...current, { role: "assistant", text }]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "Չաթը հիմա չպատասխանեց։ Կարող եք շարունակել ամրագրումը տուրի էջում։",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end">
      {open && (
        <section
          role="dialog"
          aria-label="Հարցրու տուրերի մասին"
          className="flex h-[min(70dvh,32rem)] w-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-xl sm:w-[22rem]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-bold">Հարցրու տուրերի մասին</p>
              <p className="text-xs text-muted-foreground">Միայն կայքի հրապարակային տվյալներ</p>
            </div>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
              aria-label="Փակել չաթը"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <p className="mr-6 rounded-2xl bg-muted px-3 py-2 text-sm leading-6 text-foreground">{intro}</p>
            {messages.map((item, index) => (
              <p
                key={`${item.role}-${index}`}
                className={
                  item.role === "user"
                    ? "ml-8 rounded-2xl bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground"
                    : "mr-6 rounded-2xl bg-muted px-3 py-2 text-sm leading-6 text-foreground"
                }
              >
                {item.text}
              </p>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="tour-chat-message">
              Հարցը
            </label>
            <input
              id="tour-chat-message"
              value={draft}
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Օրինակ՝ Գառնիի գինը"
              className="min-h-11 flex-1 rounded-full border border-input bg-background px-4 text-base"
            />
            <button
              type="submit"
              disabled={pending || draft.trim().length === 0}
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "…" : "Ուղարկել"}
            </button>
          </form>
        </section>
      )}
      <button
        type="button"
        className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MessageCircle className="h-5 w-5" />
        Հարցրու տուրերի մասին
      </button>
    </div>
  );
}
