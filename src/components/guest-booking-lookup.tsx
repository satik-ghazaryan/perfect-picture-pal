import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GuestBooking, LookupCrewMember } from "@/lib/booking-lookup";

function shownDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function CrewCard({ label, person }: { label: string; person: LookupCrewMember | null }) {
  return (
    <article className="flex items-center gap-3 rounded-2xl bg-muted px-3 py-3">
      {person && (
        <Avatar className="h-12 w-12">
          {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-sm font-bold">
            {person.fullName.trim().charAt(0) || "•"}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold">
          {person ? person.fullName : "Դեռ նշանակված չէ։"}
        </p>
      </div>
    </article>
  );
}

/** For people who booked without an account: the ticket code and phone open that one booking. */
export function GuestBookingLookup({
  initialCode = "",
  title = "Ամրագրել եք առանց գրանցվելու՞",
  intro = "Գրեք տոմսի կոդը և այն հեռախոսահամարը, որով ամրագրել եք։",
}: {
  initialCode?: string;
  title?: string;
  intro?: string;
} = {}) {
  const [ticketCode, setTicketCode] = useState(initialCode);
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<GuestBooking | null>(null);

  const find = async () => {
    setPending(true);
    setError("");
    setBooking(null);
    try {
      const response = await fetch("/api/bookings/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketCode, phone }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        booking?: GuestBooking;
      } | null;
      if (!response.ok || !payload?.booking) {
        setError(typeof payload?.error === "string" ? payload.error : "Ամրագրումը հիմա չբեռնվեց։");
        return;
      }
      setBooking(payload.booking);
    } catch {
      setError("Ամրագրումը հիմա չբեռնվեց։ Ստուգեք ինտերնետ կապը։");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-5">
      <h2 className="text-lg font-black tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="lookup-code">Տոմսի կոդ</Label>
          <Input
            id="lookup-code"
            value={ticketCode}
            onChange={(event) => setTicketCode(event.target.value)}
            placeholder="AG-7933D3BB"
            autoComplete="off"
            className="h-11 rounded-2xl"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lookup-phone">Հեռախոսահամար</Label>
          <Input
            id="lookup-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+374 00 000000"
            autoComplete="tel"
            className="h-11 rounded-2xl"
          />
        </div>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        <Button
          type="submit"
          variant="outline"
          className="h-11 w-full rounded-full font-bold"
          disabled={pending}
        >
          {pending ? "Փնտրում է" : "Գտնել ամրագրումը"}
        </Button>
      </form>

      {booking && (
        <div className="mt-5 space-y-3 border-t border-border pt-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{booking.ticketCode}</p>
            <h3 className="text-base font-black leading-snug">
              {booking.tourTitle || "Տուրի անունը հասանելի չէ"}
            </h3>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Մեկնում</dt>
              <dd className="font-semibold">
                {shownDate(booking.departureDate) || "Ամսաթիվը նշված չէ"}
                {booking.departureTime ? ` · ${booking.departureTime}` : ""}
              </dd>
              {booking.departurePlace && (
                <dd className="text-muted-foreground">{booking.departurePlace}</dd>
              )}
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ուղևոր</dt>
              <dd className="font-semibold">{booking.passengerName}</dd>
              <dd className="text-muted-foreground">
                {booking.adults} մեծահասակ · {booking.children} երեխա
                {booking.seatNumbers.length > 0
                  ? ` · նստատեղ ${booking.seatNumbers.join(", ")}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Վիճակ</dt>
              <dd className="font-semibold">
                {booking.status === "cancelled"
                  ? "Ամրագրումը չեղարկված է"
                  : booking.paid
                    ? "Ամրագրված և վճարված"
                    : "Ամրագրված, վճարումը հաստատված չէ"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Գումար</dt>
              <dd className="font-semibold">{booking.amount.toLocaleString("en-US")} ֏</dd>
            </div>
          </dl>
          {booking.status !== "cancelled" &&
            (booking.crewRevealed ? (
              <div>
                <h4 className="text-sm font-black">Ձեր զբոսավարը և վարորդը</h4>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <CrewCard label="Զբոսավար" person={booking.guide} />
                  <CrewCard label="Վարորդ" person={booking.driver} />
                </div>
              </div>
            ) : (
              <p className="rounded-2xl bg-muted px-3 py-3 text-sm text-muted-foreground">
                Զբոսավարի և վարորդի տվյալները հասանելի կլինեն մեկնումից 1 օր առաջ։
              </p>
            ))}
          {booking.tourId && (
            <Link
              to="/tours/$id"
              params={{ id: booking.tourId }}
              className="inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              Բացել տուրի էջը
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
