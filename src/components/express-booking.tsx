import { useEffect, useState, useSyncExternalStore } from "react";
import { format } from "date-fns";
import { hy } from "date-fns/locale";
import { Check, CreditCard, Minus, Plus, Smartphone, Ticket, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatAmd, type Tour } from "@/data/tours";
import {
  getLoyaltyServerSnapshot,
  getLoyaltySnapshot,
  hydrateLoyalty,
  loadLoyalty,
  phoneKey,
  quoteCheckout,
  subscribeLoyalty,
} from "@/lib/loyalty";
import { completeCheckout, type CheckoutSuccess } from "@/lib/payments";
import { getAdminServerSnapshot, getAdminSnapshot, hydrateAdmin, subscribeAdmin } from "@/lib/admin";

const methods = [
  { id: "idram", label: "Idram", hint: "Էլեկտրոնային դրամապանակ", icon: Wallet },
  { id: "telcell", label: "Telcell", hint: "Էլեկտրոնային դրամապանակ", icon: Smartphone },
  { id: "arca", label: "ArCa / Visa", hint: "Բանկային քարտ", icon: CreditCard },
] as const;

type MethodId = (typeof methods)[number]["id"];

function nextDeparture(day: Tour["day"]) {
  const now = new Date();
  const target = day === "saturday" ? 6 : 0;
  const date = new Date(now);
  date.setDate(now.getDate() + ((target - now.getDay() + 7) % 7 || 7));
  return date;
}

function validPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function TicketQr({ value }: { value: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then((QR) =>
      QR.toDataURL(value, { margin: 1, width: 192, errorCorrectionLevel: "M" }).then((url) => {
        if (!cancelled) setSrc(url);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <span className="grid h-24 w-24 shrink-0 place-items-center rounded-xl bg-white p-1">
      {src ? <img src={src} alt="" className="h-full w-full" /> : <span className="h-full w-full" />}
    </span>
  );
}

export function BookingPanel({ tour }: { tour: Tour }) {
  const departure = nextDeparture(tour.day);
  const [party, setParty] = useState({ adults: tour.seatsLeft > 0 ? 1 : 0, children: 0 });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [method, setMethod] = useState<MethodId | null>(null);
  const [code, setCode] = useState("");
  const [seat, setSeat] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<CheckoutSuccess | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const wallet = useSyncExternalStore(subscribeLoyalty, getLoyaltySnapshot, getLoyaltyServerSnapshot);
  const cashback = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot).settings
    .cashbackPercent;

  useEffect(() => {
    hydrateLoyalty();
    hydrateAdmin();
  }, []);

  const guests = party.adults + party.children;
  const total = guests * tour.price;
  const balance = wallet.accounts[phoneKey(phone)]?.points ?? 0;
  const pointsOn = usePoints && balance > 0;
  const quote = quoteCheckout(balance, total, pointsOn, cashback / 100);
  const coveredByPoints = pointsOn && quote.payable === 0;
  const soldOut = tour.seatsLeft < 1;
  const low = tour.seatsLeft > 0 && tour.seatsLeft <= 5;
  const selectedMethod = methods.find((item) => item.id === method);

  const changeParty = (key: "adults" | "children", delta: number) => {
    setParty((current) => {
      const next = { ...current, [key]: current[key] + delta };
      if (next.adults < 1 || next.children < 0) return current;
      if (next.adults + next.children > tour.seatsLeft) return current;
      return next;
    });
  };

  const reset = () => {
    setStep(1);
    setName("");
    setPhone("");
    setError("");
    setMethod(null);
    setCode("");
    setSeat(null);
    setReceipt(null);
    setUsePoints(false);
    setNotify(true);
    setSaving(false);
  };

  const continueDetails = async () => {
    if (name.trim().length < 2) {
      setError("Գրեք ձեր անունը։");
      toast.error("Գրեք ձեր անունը։");
      return;
    }
    if (!validPhone(phone)) {
      setError("Գրեք գործող հեռախոսահամար։");
      toast.error("Գրեք գործող հեռախոսահամար։");
      return;
    }
    setError("");
    try {
      await loadLoyalty(phone);
    } catch {
      /* The local wallet still shows any points saved in this browser. */
    }
    setStep(2);
  };

  const confirmPayment = async () => {
    if (!coveredByPoints && !method) {
      setError("Ընտրեք վճարման եղանակը։");
      toast.error("Ընտրեք վճարման եղանակը։");
      return;
    }
    setError("");
    setSaving(true);
    const toastId = toast.loading(coveredByPoints ? "Տոմսը ձևավորվում է…" : "Վճարումը սպասման մեջ է…");
    try {
      const result = await completeCheckout({
        provider: method,
        tourId: tour.id,
        tourTitle: tour.title,
        passengerName: name.trim(),
        phone: phone.trim(),
        adults: party.adults,
        children: party.children,
        total,
        usePoints: pointsOn,
        balance,
        notify,
        departureTime: tour.departureTime,
      });
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message, { id: toastId });
        return;
      }
      setCode(result.ticketCode);
      setSeat(result.seatNumber);
      setReceipt(result);
      setStep(3);
      toast.success(result.coveredByPoints ? "Տուրն ծածկվեց միավորներով" : "Ամրագրումը հաստատվեց", {
        id: toastId,
        description: result.pointsSaved
          ? [
              result.redeemed > 0 ? `Օգտագործվեց ${result.redeemed} միավոր` : "",
              result.earned > 0 ? `+${result.earned} հետվճար` : "",
              `մնացորդ ${result.points}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "Տոմսը պատրաստ է։ Միավորները չգրանցվեցին, կրկին մի հաստատեք։",
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Ամրագրումը չպահպանվեց։";
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <aside id="book" className="fixed inset-x-0 bottom-0 z-40 scroll-mt-24 p-3 lg:static lg:z-auto lg:p-0">
        <div className="rounded-3xl border border-border bg-card p-4 shadow-float lg:sticky lg:top-24">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-black text-primary">{formatAmd(tour.price)}</p>
              <p className="text-[11px] text-muted-foreground">մեկ անձի համար</p>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-bold",
                soldOut || low
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary-soft text-primary",
              )}
            >
              {soldOut ? "Տեղերը սպառվել են" : `Մնացել է ${tour.seatsLeft} տեղ`}
            </span>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {format(departure, "d MMMM, EEEE", { locale: hy })} · {tour.departureTime}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <PartyCounter
              label="Մեծահասակ"
              value={party.adults}
              onDecrease={() => changeParty("adults", -1)}
              onIncrease={() => changeParty("adults", 1)}
              decreaseDisabled={party.adults <= 1}
              increaseDisabled={guests >= tour.seatsLeft}
            />
            <PartyCounter
              label="Երեխա"
              value={party.children}
              onDecrease={() => changeParty("children", -1)}
              onIncrease={() => changeParty("children", 1)}
              decreaseDisabled={party.children <= 0}
              increaseDisabled={guests >= tour.seatsLeft}
            />
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Ընդամենը</span>
            <span className="font-extrabold">{formatAmd(total)}</span>
          </div>

          <Button
            className="mt-4 h-11 w-full rounded-full font-bold"
            disabled={soldOut || guests < 1}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            Ամրագրել հիմա
          </Button>
        </div>
      </aside>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {step === 3 ? "Ամրագրումը հաստատված է" : "Արագ ամրագրում"}
            </DialogTitle>
            <DialogDescription>
              {step === 1 && "Քայլ 1 / 3 · Կոնտակտային տվյալներ"}
              {step === 2 && "Քայլ 2 / 3 · Վճարման եղանակ"}
              {step === 3 && "Քայլ 3 / 3 · Թվային տոմս"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1.5" aria-hidden>
            {[1, 2, 3].map((item) => (
              <span
                key={item}
                className={cn("h-1.5 flex-1 rounded-full", item <= step ? "bg-primary" : "bg-muted")}
              />
            ))}
          </div>

          {step === 1 && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void continueDetails();
              }}
            >
              <p className="rounded-2xl bg-primary-soft px-3 py-2 text-xs font-medium text-foreground">
                {party.adults} մեծահասակ · {party.children} երեխա · {formatAmd(total)}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="guest-name">Անուն</Label>
                <Input
                  id="guest-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Անուն Ազգանուն"
                  autoComplete="name"
                  className="h-11 rounded-2xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="guest-phone">Հեռախոսահամար</Label>
                <Input
                  id="guest-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+374 00 000000"
                  autoComplete="tel"
                  inputMode="tel"
                  className="h-11 rounded-2xl"
                />
              </div>
              {error && <p className="text-xs font-medium text-destructive">{error}</p>}
              <Button type="submit" className="h-11 w-full rounded-full font-bold">
                Շարունակել
              </Button>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {methods.map((item) => {
                const Icon = item.icon;
                const active = method === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setMethod(item.id);
                      setError("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
                      active ? "border-primary bg-primary-soft" : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-card text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{item.label}</span>
                      <span className="block text-xs text-muted-foreground">{item.hint}</span>
                    </span>
                    {active && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-3 py-3">
                <div className="min-w-0">
                  <Label htmlFor="use-points">Օգտագործել կուտակված միավորները</Label>
                  <p className="text-xs text-muted-foreground">
                    {balance > 0
                      ? `${balance} միավոր հասանելի է · առավելագույն զեղչ ${formatAmd(quote.maxRedeem)}`
                      : "Այս համարով միավորներ դեռ չկան"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">1 միավոր = 1 ֏</p>
                </div>
                <Switch
                  id="use-points"
                  checked={pointsOn}
                  disabled={balance < 1 || saving}
                  onCheckedChange={(checked) => {
                    setUsePoints(checked);
                    setError("");
                  }}
                />
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-border px-3 py-3">
                <Checkbox
                  id="send-ticket"
                  checked={notify}
                  disabled={saving}
                  onCheckedChange={(checked) => setNotify(checked === true)}
                />
                <Label htmlFor="send-ticket" className="cursor-pointer text-sm font-medium leading-snug">
                  Ուղարկել տոմսը WhatsApp-ով / SMS-ով
                </Label>
              </div>
              <div className="space-y-1 rounded-2xl bg-muted px-3 py-2 text-xs">
                <p className="flex justify-between">
                  <span>Տուրի գին</span>
                  <span className="font-bold">{formatAmd(total)}</span>
                </p>
                {quote.redeem > 0 && (
                  <p className="flex justify-between">
                    <span>Զեղչ միավորներով</span>
                    <span className="font-bold">−{formatAmd(quote.redeem)}</span>
                  </p>
                )}
                <p className="flex justify-between">
                  <span>Վճարման ենթակա</span>
                  <span className="font-bold">{formatAmd(quote.payable)}</span>
                </p>
                {coveredByPoints ? (
                  <p className="text-muted-foreground">
                    Տուրն ամբողջությամբ ծածկված է միավորներով։ Վճարման դարպասը բաց է թողնվում։ Հետվճար՝ 0,
                    որովհետև կանխիկ վճարում չկա։
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {quote.payable > 0 && method
                      ? `${methods.find((item) => item.id === method)?.label} կգանձի ${formatAmd(quote.payable)}։ `
                      : ""}
                    Հետվճար այս վճարումից՝ +{quote.earn} միավոր ({cashback}%)
                  </p>
                )}
              </div>
              {error && <p className="text-xs font-medium text-destructive">{error}</p>}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setStep(1)}>
                  Հետ
                </Button>
                <Button type="button" className="rounded-full font-bold" disabled={saving} onClick={() => void confirmPayment()}>
                  {saving ? "Հաստատվում է" : coveredByPoints ? "Ստանալ տոմսը" : "Հաստատել"}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-3xl border border-border bg-card">
                <div className="flex items-center justify-between bg-navy px-4 py-3 text-navy-foreground">
                  <div>
                    <p className="text-sm font-extrabold">Արի Գնանք</p>
                    <p className="text-[11px] text-navy-foreground/70">Թվային տոմսի նախադիտում</p>
                  </div>
                  <Ticket className="h-5 w-5 text-accent" />
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <p className="text-sm font-bold leading-snug">{tour.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format(departure, "d MMMM", { locale: hy })} · {tour.departureTime}–{tour.returnTime}
                    </p>
                    <p className="text-xs text-muted-foreground">{tour.departurePlace}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <p>
                      <span className="block text-muted-foreground">Ուղևոր</span>
                      <span className="font-semibold">{name.trim()}</span>
                    </p>
                    <p>
                      <span className="block text-muted-foreground">Հեռախոս</span>
                      <span className="font-semibold">{phone.trim()}</span>
                    </p>
                    <p>
                      <span className="block text-muted-foreground">Մասնակիցներ</span>
                      <span className="font-semibold">
                        {party.adults} մեծահասակ · {party.children} երեխա
                      </span>
                    </p>
                    <p>
                      <span className="block text-muted-foreground">Վճարում</span>
                      <span className="font-semibold">
                        {receipt?.coveredByPoints
                          ? `Միավորներով · ${formatAmd(0)}`
                          : `${selectedMethod?.label ?? "Վճարում"} · ${formatAmd(receipt?.payable ?? quote.payable)}`}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted p-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Ամրագրման կոդ</p>
                      <p className="font-mono text-sm font-bold tracking-wide">{code}</p>
                      {seat !== null && (
                        <p className="mt-1 text-[11px] text-muted-foreground">Նստատեղ {seat}</p>
                      )}
                      {receipt?.notified && (
                        <p className="mt-1 text-[11px] text-muted-foreground">SMS և WhatsApp ուղարկված է</p>
                      )}
                      {receipt?.pointsSaved && receipt.redeemed > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Օգտագործվեց {receipt.redeemed} միավոր
                        </p>
                      )}
                      {receipt?.pointsSaved && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {receipt.earned > 0 ? `+${receipt.earned} հետվճար · ` : ""}մնացորդ {receipt.points}
                        </p>
                      )}
                      {receipt && !receipt.pointsSaved && (
                        <p className="mt-1 text-[11px] text-muted-foreground">Միավորները չգրանցվեցին</p>
                      )}
                    </div>
                    <TicketQr value={code} />
                  </div>
                </div>
              </div>
              <Button type="button" className="h-11 w-full rounded-full font-bold" onClick={() => setOpen(false)}>
                Փակել
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PartyCounter({
  label,
  value,
  onDecrease,
  onIncrease,
  decreaseDisabled,
  increaseDisabled,
}: {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseDisabled: boolean;
  increaseDisabled: boolean;
}) {
  return (
    <div className="rounded-2xl bg-muted px-2.5 py-2">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onDecrease}
          disabled={decreaseDisabled}
          aria-label={`${label}՝ պակասեցնել`}
          className="grid h-7 w-7 place-items-center rounded-full bg-card text-foreground disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="text-sm font-extrabold">{value}</span>
        <button
          type="button"
          onClick={onIncrease}
          disabled={increaseDisabled}
          aria-label={`${label}՝ ավելացնել`}
          className="grid h-7 w-7 place-items-center rounded-full bg-card text-foreground disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
