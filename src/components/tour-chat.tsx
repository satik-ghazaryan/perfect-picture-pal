import { useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { MessageCircle, X } from "lucide-react";
import { completeCheckout, type PaymentProvider } from "@/lib/payments";
import { getTouristSnapshot } from "@/lib/admin";
import { bookingSummary, validConfirmationToken, validGuestPhone, type ChatBookingOffer, type ChatDepartureChoice } from "@/lib/tour-chat-booking";
import type { InterestOffer } from "@/lib/tour-interest";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type BookingDraft = {
  offer: ChatBookingOffer;
  departure: ChatDepartureChoice;
  adults: number;
  children: number;
  name: string;
  phone: string;
  provider: PaymentProvider | null;
  step: "form" | "review" | "done";
  key: string;
  proof: string;
  ticket: string;
  note: string;
};

const LINK = /(\[[^\]]+\]\(\/tours\/[a-z0-9-]+(?:\?ticket=AG-[A-Za-z0-9-]+)?\))/g;
const LINK_PART = /^\[([^\]]+)\]\((\/tours\/[a-z0-9-]+(?:\?ticket=AG-[A-Za-z0-9-]+)?)\)/;

function ChatText({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(LINK);
  return (
    <p
      className={
        mine
          ? "ml-8 rounded-2xl bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground"
          : "mr-6 rounded-2xl bg-muted px-3 py-2 text-sm leading-6 text-foreground"
      }
    >
      {parts.map((part, index) => {
        const link = LINK_PART.exec(part);
        if (!link) return <span key={index}>{part}</span>;
        return (
          <a key={index} href={link[2]} className="font-bold underline">
            {link[1]}
          </a>
        );
      })}
    </p>
  );
}

const STAFF_PATH = /^\/(admin|guide|driver|login)(\/|$)/;

function pageTourId(pathname: string) {
  const match = /^\/tours\/([a-z0-9-]{1,64})$/.exec(pathname);
  return match?.[1] ?? "";
}

export function TourChat() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tourId = pageTourId(pathname);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [offer, setOffer] = useState<ChatBookingOffer | null>(null);
  const [interest, setInterest] = useState<InterestOffer | null>(null);
  const [interestForm, setInterestForm] = useState<{
    label: string;
    tourId: string | null;
    phone: string;
    consent: boolean;
    note: string;
  } | null>(null);
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null);
  const saving = useRef(false);
  const intro = tourId
    ? "Գրեք, թե ինչն եք ուզում իմանալ այս տուրի մասին։"
    : "Գրեք տուրի անունը, օրինակ՝ Գառնի։";
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  if (STAFF_PATH.test(pathname)) return null;

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || pending) return;
    const history = [{ role: "assistant" as const, text: intro }, ...messages].slice(-6);
    setInput("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setPending(true);
    try {
      const response = await fetch("/api/tour-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, tourId, history }),
      });
      const payload = (await response.json()) as {
        reply?: string;
        error?: string;
        booking?: ChatBookingOffer | null;
        interest?: InterestOffer | null;
      };
      const reply =
        payload.reply ||
        payload.error ||
        "Չաթը հիմա չպատասխանեց։ Կարող եք շարունակել ամրագրումը տուրի էջում։";
      setMessages((current) => [...current, { role: "assistant", text: reply }]);
      setOffer(payload.booking ?? null);
      if (!interestForm) setInterest(payload.interest ?? null);
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

  async function registerInterest() {
    if (!interestForm || saving.current) return;
    if (!interestForm.consent) {
      setInterestForm({ ...interestForm, note: "Նշեք, որ համաձայն եք ծանուցում ստանալ այս ուղղության մասին։" });
      return;
    }
    if (interestForm.label.trim().length < 2) {
      setInterestForm({ ...interestForm, note: "Գրեք ուղղությունը։" });
      return;
    }
    if (!validGuestPhone(interestForm.phone)) {
      setInterestForm({ ...interestForm, note: "Հեռախոսը պետք է ունենա 8–15 թվանշան։" });
      return;
    }
    saving.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/tour-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "interest-register",
          direction: interestForm.label.trim(),
          interestTourId: interestForm.tourId,
          phone: interestForm.phone,
          consent: true,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string };
      if (!payload.ok) {
        setInterestForm({ ...interestForm, note: payload.message || "Հետաքրքրությունը չգրանցվեց։" });
        return;
      }
      setInterestForm(null);
      setInterest(null);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "Հետաքրքրությունդ գրանցված է։ Երբ այս ուղղությամբ ամրագրման համար բաց մեկնում հրապարակվի, կտեղեկացնենք քեզ",
        },
      ]);
    } catch {
      setInterestForm({ ...interestForm, note: "Հետաքրքրությունը չգրանցվեց։" });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  function startDeparture(departure: ChatDepartureChoice) {
    if (!offer) return;
    const tourist = getTouristSnapshot();
    const key = crypto.randomUUID();
    const proof = crypto.randomUUID();
    setBookingDraft({
      offer,
      departure,
      adults: offer.party ?? 1,
      children: 0,
      name: tourist?.role === "tourist" ? tourist.fullName : "",
      phone: tourist?.role === "tourist" ? tourist.phone : "",
      provider: null,
      step: "form",
      key,
      proof,
      ticket: "",
      note: "",
    });
  }

  async function confirmBooking() {
    if (!bookingDraft || saving.current) return;
    if (!validConfirmationToken(bookingDraft.key) || !validConfirmationToken(bookingDraft.proof)) return;
    const party = bookingDraft.adults + bookingDraft.children;
    const price = bookingDraft.offer.price ?? 0;
    if (price > 0 && !bookingDraft.provider) {
      setBookingDraft({ ...bookingDraft, note: "Ընտրեք վճարման եղանակը։ Վճարումը սիմուլացված է։" });
      return;
    }
    if (bookingDraft.offer.cashbackPercent == null) {
      setBookingDraft({ ...bookingDraft, note: "Մեկնման տվյալները չբեռնվեցին։ Թիվ չեմ նշում։" });
      return;
    }
    setPending(true);
    saving.current = true;
    try {
      if (bookingDraft.offer.fixture) {
        const response = await fetch("/api/tour-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "isolated-confirm",
            departureId: bookingDraft.departure.id,
            adults: bookingDraft.adults,
            children: bookingDraft.children,
            expectedPrice: price,
            expectedSeats: bookingDraft.departure.seats,
            expectedDate: bookingDraft.departure.date,
            expectedCashback: bookingDraft.offer.cashbackPercent,
            key: bookingDraft.key,
            proof: bookingDraft.proof,
          }),
        });
        const payload = (await response.json()) as {
          check?: { ok: boolean; code?: string; message?: string; ticketCode?: string; fresh?: { price: number; seats: number; date: string; cashbackPercent: number } };
        };
        const check = payload.check;
        if (!check?.ok) {
          const fresh = check?.fresh;
          setBookingDraft({
            ...bookingDraft,
            note: check?.message || "Ամրագրումը չհաստատվեց։",
            offer: fresh
              ? { ...bookingDraft.offer, price: fresh.price > 0 ? fresh.price : null, cashbackPercent: fresh.cashbackPercent }
              : bookingDraft.offer,
            departure: fresh
              ? { ...bookingDraft.departure, date: fresh.date, label: freshLabel(fresh.date), seats: fresh.seats }
              : bookingDraft.departure,
          });
          return;
        }
        const ticket = check.ticketCode || "";
        setBookingDraft(null);
        setMessages((current) => [
          ...current,
          { role: "assistant", text: `Փորձարկման ամրագրումը հաստատվեց։ Կոդը՝ ${ticket}։ Արտադրական ամրագրում չի ստեղծվել։` },
        ]);
        return;
      }
      const checkResponse = await fetch("/api/tour-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "booking-check",
          tourId: bookingDraft.offer.tourId,
          departureId: bookingDraft.departure.id,
          adults: bookingDraft.adults,
          children: bookingDraft.children,
          expectedPrice: price,
          expectedSeats: bookingDraft.departure.seats,
          expectedDate: bookingDraft.departure.date,
          expectedCashback: bookingDraft.offer.cashbackPercent ?? 0,
        }),
      });
      const checked = (await checkResponse.json()) as {
        check?: { ok: boolean; code?: string; message?: string; fresh?: { price: number; seats: number; date: string; cashbackPercent: number; total: number | null } };
        message?: string;
      };
      if (!checked.check?.ok) {
        const fresh = checked.check?.fresh;
        setBookingDraft({
          ...bookingDraft,
          note: checked.check?.message || checked.message || "Ամրագրումը չհաստատվեց։",
          offer: fresh
            ? { ...bookingDraft.offer, price: fresh.price > 0 ? fresh.price : null, cashbackPercent: fresh.cashbackPercent }
            : bookingDraft.offer,
          departure: fresh
            ? { ...bookingDraft.departure, date: fresh.date, label: freshLabel(fresh.date), seats: fresh.seats }
            : bookingDraft.departure,
        });
        return;
      }
      const result = await completeCheckout({
        provider: bookingDraft.provider,
        tourId: bookingDraft.offer.tourId || "",
        tourTitle: bookingDraft.offer.title || "",
        passengerName: bookingDraft.name.trim(),
        phone: bookingDraft.phone.trim(),
        adults: bookingDraft.adults,
        children: bookingDraft.children,
        total: price * party,
        usePoints: false,
        balance: 0,
        credit: 0,
        notify: false,
        departureTime: bookingDraft.departure.time || "",
        departureId: bookingDraft.departure.id,
        expectedDate: bookingDraft.departure.date,
        expectedPrice: price,
        expectedSeats: bookingDraft.departure.seats,
        expectedCashback: bookingDraft.offer.cashbackPercent ?? 0,
        idempotencyKey: bookingDraft.key,
        guestProof: bookingDraft.proof,
      });
      if (!result.ok) {
        if (result.stale) {
          setBookingDraft({
            ...bookingDraft,
            note: "Գինը կամ տեղերը փոխվել են։ Ստուգեք նոր ամփոփումը և հաստատեք նորից։",
            offer: { ...bookingDraft.offer, price: result.stale.price > 0 ? result.stale.price : null, cashbackPercent: result.stale.cashbackPercent },
            departure: {
              ...bookingDraft.departure,
              date: result.stale.departureDate,
              label: freshLabel(result.stale.departureDate),
              seats: result.stale.availableSeats,
            },
          });
          return;
        }
        setBookingDraft({ ...bookingDraft, note: result.message });
        return;
      }
      const ticket = result.ticketCode;
      setBookingDraft(null);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `Ամրագրումը հաստատվեց։ Կոդը՝ ${ticket}։ [Բացել տոմսը](/tours/${bookingDraft.offer.tourId}?ticket=${ticket})`,
        },
      ]);
    } catch {
      setBookingDraft({ ...bookingDraft, note: "Ամրագրումը չպահպանվեց։ Կրկին սեղմելը նույն ամրագրումն է, նորը չի բացվի։" });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  function freshLabel(date: string) {
    const parsed = parseISO(date);
    return Number.isNaN(parsed.getTime()) ? date : format(parsed, "d MMMM yyyy", { locale: hy });
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
            <ChatText text={intro} mine={false} />
            {messages.map((item, index) => (
              <ChatText key={`${item.role}-${index}`} text={item.text} mine={item.role === "user"} />
            ))}
            {offer && !bookingDraft && offer.mode === "choose-tour" && (
              <div className="flex flex-col gap-2">
                {offer.tours.map((tour) => (
                  <button
                    key={tour.id}
                    type="button"
                    className="min-h-11 rounded-2xl border border-border px-3 text-left text-sm font-semibold"
                    onClick={() => void send(`ուզում եմ ամրագրել ${tour.title}`)}
                  >
                    {tour.title}
                  </button>
                ))}
              </div>
            )}
            {offer && !bookingDraft && offer.mode === "departures" && offer.departures.length > 0 && (
              <div className="flex flex-col gap-2">
                {offer.departures.map((departure) => (
                  <button
                    key={departure.id}
                    type="button"
                    className="min-h-11 rounded-2xl border border-border px-3 text-left text-sm"
                    onClick={() => startDeparture(departure)}
                  >
                    {departure.label}
                    {departure.time ? `, ${departure.time}` : ""} · {departure.seats} ազատ
                  </button>
                ))}
              </div>
            )}
            {interest && !interestForm && !bookingDraft && (
              <button
                type="button"
                className="min-h-11 rounded-2xl border border-border px-3 text-left text-sm font-semibold"
                onClick={() =>
                  setInterestForm({
                    label: interest.label,
                    tourId: interest.tourId,
                    phone: "",
                    consent: false,
                    note: "",
                  })
                }
              >
                Տեղեկացրեք ինձ, երբ տուր լինի
              </button>
            )}
            {interestForm && (
              <div className="space-y-2 rounded-2xl bg-muted p-3">
                <label className="block text-xs" htmlFor="chat-interest-direction">
                  Ուղղություն
                  <input
                    id="chat-interest-direction"
                    value={interestForm.label}
                    onChange={(event) =>
                      setInterestForm({
                        ...interestForm,
                        label: event.target.value,
                        tourId: event.target.value.trim() === interest?.label ? interest.tourId : null,
                        note: "",
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                  />
                </label>
                <label className="block text-xs" htmlFor="chat-interest-phone">
                  Հեռախոս
                  <input
                    id="chat-interest-phone"
                    value={interestForm.phone}
                    autoComplete="tel"
                    inputMode="tel"
                    onChange={(event) => setInterestForm({ ...interestForm, phone: event.target.value, note: "" })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                  />
                </label>
                <label className="flex min-h-11 items-start gap-2 text-sm" htmlFor="chat-interest-consent">
                  <input
                    id="chat-interest-consent"
                    type="checkbox"
                    checked={interestForm.consent}
                    onChange={(event) => setInterestForm({ ...interestForm, consent: event.target.checked, note: "" })}
                    className="mt-1 h-5 w-5"
                  />
                  Համաձայն եմ այս ուղղության մասին ծանուցում ստանալ
                </label>
                {interestForm.note && <p className="text-sm text-destructive">{interestForm.note}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending || !interestForm.consent}
                    className="min-h-11 flex-1 rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
                    onClick={() => void registerInterest()}
                  >
                    Գրանցել հետաքրքրություն
                  </button>
                  <button type="button" className="min-h-11 rounded-full px-3 text-sm" onClick={() => setInterestForm(null)}>
                    Չեղարկել
                  </button>
                </div>
              </div>
            )}
            {bookingDraft && bookingDraft.step === "form" && (
              <div className="space-y-2 rounded-2xl bg-muted p-3">
                <p className="text-sm font-semibold">Ամրագրել որպես հյուր</p>
                <label className="block text-xs" htmlFor="chat-booking-name">
                  Անուն
                  <input
                    id="chat-booking-name"
                    value={bookingDraft.name}
                    autoComplete="name"
                    onChange={(event) => setBookingDraft({ ...bookingDraft, name: event.target.value, note: "" })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                  />
                </label>
                <label className="block text-xs" htmlFor="chat-booking-phone">
                  Հեռախոս
                  <input
                    id="chat-booking-phone"
                    value={bookingDraft.phone}
                    autoComplete="tel"
                    inputMode="tel"
                    onChange={(event) => setBookingDraft({ ...bookingDraft, phone: event.target.value, note: "" })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs" htmlFor="chat-booking-adults">
                    Մեծահասակ
                    <input
                      id="chat-booking-adults"
                      type="number"
                      min={1}
                      max={30}
                      value={bookingDraft.adults}
                      onChange={(event) => setBookingDraft({ ...bookingDraft, adults: Number(event.target.value), note: "" })}
                      className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                    />
                  </label>
                  <label className="text-xs" htmlFor="chat-booking-children">
                    Երեխա
                    <input
                      id="chat-booking-children"
                      type="number"
                      min={0}
                      max={30}
                      value={bookingDraft.children}
                      onChange={(event) => setBookingDraft({ ...bookingDraft, children: Number(event.target.value), note: "" })}
                      className="mt-1 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base"
                    />
                  </label>
                </div>
                {bookingDraft.offer.price != null && bookingDraft.offer.price > 0 && (
                  <div className="grid gap-2">
                    {(
                      [
                        ["idram", "Idram"],
                        ["telcell", "Telcell"],
                        ["arca", "ArCa / Visa"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${bookingDraft.provider === id ? "border-primary bg-background" : "border-border"}`}
                        onClick={() => setBookingDraft({ ...bookingDraft, provider: id, note: "" })}
                      >
                        {label}
                      </button>
                    ))}
                    <p className="text-xs text-muted-foreground">Վճարումը սիմուլացված է։</p>
                  </div>
                )}
                {bookingDraft.note && <p className="text-sm text-destructive">{bookingDraft.note}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="min-h-11 flex-1 rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground"
                    onClick={() => {
                      const party = bookingDraft.adults + bookingDraft.children;
                      if (bookingDraft.name.trim().length < 2) {
                        setBookingDraft({ ...bookingDraft, note: "Գրեք անունը։" });
                        return;
                      }
                      if (!validGuestPhone(bookingDraft.phone)) {
                        setBookingDraft({ ...bookingDraft, note: "Հեռախոսը պետք է ունենա 8–15 թվանշան։" });
                        return;
                      }
                      if (!Number.isInteger(party) || bookingDraft.adults < 1 || bookingDraft.children < 0 || party > 30) {
                        setBookingDraft({ ...bookingDraft, note: "Մասնակիցների թիվը 1-ից 30 է։" });
                        return;
                      }
                      if ((bookingDraft.offer.price ?? 0) > 0 && !bookingDraft.provider) {
                        setBookingDraft({ ...bookingDraft, note: "Ընտրեք վճարման եղանակը։ Վճարումը սիմուլացված է։" });
                        return;
                      }
                      setBookingDraft({ ...bookingDraft, step: "review", note: "" });
                    }}
                  >
                    Շարունակել
                  </button>
                  <button type="button" className="min-h-11 rounded-full px-3 text-sm" onClick={() => setBookingDraft(null)}>
                    Չեղարկել
                  </button>
                </div>
              </div>
            )}
            {bookingDraft && bookingDraft.step === "review" && (
              <div className="space-y-2 rounded-2xl bg-muted p-3">
                <p className="text-sm leading-6">
                  {bookingSummary({
                    title: bookingDraft.offer.title || "",
                    dateLabel: bookingDraft.departure.label,
                    time: bookingDraft.departure.time,
                    place: bookingDraft.offer.place,
                    party: bookingDraft.adults + bookingDraft.children,
                    price: bookingDraft.offer.price,
                  })}
                </p>
                {bookingDraft.note && <p className="text-sm text-destructive">{bookingDraft.note}</p>}
                <button
                  type="button"
                  disabled={pending}
                  className="min-h-11 w-full rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
                  onClick={() => void confirmBooking()}
                >
                  Հաստատել ամրագրումը
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="min-h-11 flex-1 rounded-full border border-border px-3 text-sm"
                    onClick={() => setBookingDraft({ ...bookingDraft, step: "form", note: "" })}
                  >
                    Խմբագրել
                  </button>
                  <button type="button" className="min-h-11 flex-1 rounded-full border border-border px-3 text-sm" onClick={() => setBookingDraft(null)}>
                    Չեղարկել
                  </button>
                </div>
              </div>
            )}
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
              value={input}
              maxLength={500}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Օրինակ՝ Գառնիի գինը"
              className="min-h-11 flex-1 rounded-full border border-input bg-background px-4 text-base"
            />
            <button
              type="submit"
              disabled={pending || input.trim().length === 0}
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
