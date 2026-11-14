import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { claimGuestBooking } from "@/lib/guest-claims";

/** For a booking made without an account (on the site or in Telegram): code + phone add it here. */
export function LinkGuestBooking({ onLinked }: { onLinked: () => void }) {
  const [ticketCode, setTicketCode] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const link = async () => {
    setPending(true);
    setMessage(null);
    const result = await claimGuestBooking(ticketCode, phone);
    setPending(false);
    if (!result.ok) {
      setMessage({ ok: false, text: result.message });
      return;
    }
    setMessage({
      ok: true,
      text: result.already ? "Այս ամրագրումն արդեն ձեր հաշվում է։" : "Ամրագրումը կցվեց ձեր հաշվին։",
    });
    setTicketCode("");
    setPhone("");
    onLinked();
  };

  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <h2 className="text-base font-black tracking-tight">Ամրագրել եք առանց հաշվի՞</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Կայքում կամ Telegram-ում առանց մուտքի արված ամրագրումը կցեք ձեր հաշվին՝ տոմսի կոդով և այն
        հեռախոսահամարով, որով ամրագրել եք։
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void link();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="link-code">Տոմսի կոդ</Label>
          <Input
            id="link-code"
            value={ticketCode}
            onChange={(event) => setTicketCode(event.target.value)}
            placeholder="AG-7933D3BB"
            autoComplete="off"
            className="h-11 rounded-2xl"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="link-phone">Հեռախոսահամար</Label>
          <Input
            id="link-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+374 00 000000"
            autoComplete="tel"
            className="h-11 rounded-2xl"
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          className="h-11 rounded-full font-bold"
          disabled={pending || !ticketCode.trim() || !phone.trim()}
        >
          {pending ? "Կցում է" : "Կցել"}
        </Button>
      </form>
      {message && (
        <p
          className={
            message.ok
              ? "mt-3 text-sm font-semibold text-primary"
              : "mt-3 text-sm font-medium text-destructive"
          }
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
