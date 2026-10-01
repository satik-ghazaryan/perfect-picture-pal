import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { format } from "date-fns";
import { hy } from "date-fns/locale";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getLoyaltyServerSnapshot,
  getLoyaltySnapshot,
  hydrateLoyalty,
  loadLoyalty,
  phoneKey,
  subscribeLoyalty,
  type LoyaltyAccount,
} from "@/lib/loyalty";
import { getAdminServerSnapshot, getAdminSnapshot, hydrateAdmin, subscribeAdmin } from "@/lib/admin";
import { notificationsForPhone, hydrateNotifications } from "@/lib/notifications";

export const Route = createFileRoute("/loyalty")({
  head: () => ({
    meta: [
      { title: "Իմ միավորները — Արի Գնանք" },
      {
        name: "description",
        content: "Արմավիրից ամրագրված տուրերի 5% հետվճարը միավորներով։",
      },
    ],
  }),
  component: LoyaltyPage,
});

function LoyaltyPage() {
  const wallet = useSyncExternalStore(subscribeLoyalty, getLoyaltySnapshot, getLoyaltyServerSnapshot);
  const cashback = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot).settings
    .cashbackPercent;
  const [ready, setReady] = useState(false);
  const [phone, setPhone] = useState("");
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    hydrateLoyalty();
    hydrateAdmin();
    hydrateNotifications();
    setPhone(getLoyaltySnapshot().lastPhone);
    setReady(true);
  }, []);

  const shown = account ?? (phoneKey(phone) ? wallet.accounts[phoneKey(phone)] ?? null : null);
  const messages = shown ? notificationsForPhone(shown.phone) : [];

  const lookup = async () => {
    setLoading(true);
    try {
      const next = await loadLoyalty(phone);
      setAccount(next);
      if (next.points < 1 && next.history.length < 1) {
        toast.message("Այս համարով միավորներ դեռ չկան");
      } else {
        toast.success(`Մնացորդը՝ ${next.points} միավոր`);
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Միավորները չբեռնվեցին։");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader showBack />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-wide text-primary">Հավատարմություն</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Իմ միավորները</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Արմավիրից ամրագրված յուրաքանչյուր տուրի վճարված գումարի {cashback}%-ը
          վերադառնում է միավորներով։ 1 միավոր = 1 ֏ զեղչ հաջորդ ամրագրման ժամանակ։
        </p>

        {!ready ? (
          <p className="mt-8 text-sm text-muted-foreground">Բեռնվում է...</p>
        ) : (
          <div className="mt-6 space-y-4">
            <form
              className="rounded-3xl border border-border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void lookup();
              }}
            >
              <Label htmlFor="loyalty-phone">Հեռախոսահամար</Label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  id="loyalty-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+374 00 000000"
                  autoComplete="tel"
                  inputMode="tel"
                  className="h-11 rounded-2xl"
                />
                <Button type="submit" className="h-11 rounded-full font-bold" disabled={loading}>
                  {loading ? "Բեռնվում է" : "Դիտել"}
                </Button>
              </div>
            </form>

            <section className="rounded-3xl bg-primary-soft p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Կուտակված միավորներ</p>
                  <p className="mt-1 text-4xl font-black text-primary">{shown?.points ?? 0}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {shown?.fullName ? shown.fullName : "Միավորները կապված են ամրագրման հեռախոսահամարին"}
                  </p>
                </div>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-card text-primary">
                  <Sparkles className="h-5 w-5" />
                </span>
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">Շարժ</h2>
              {shown && shown.history.length > 0 ? (
                <ul className="mt-3 divide-y divide-border">
                  {shown.history.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold">{entry.note}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(entry.createdAt), "d MMMM, HH:mm", { locale: hy })}
                        </p>
                      </div>
                      <span className={entry.kind === "earn" ? "font-bold text-primary" : "font-bold"}>
                        {entry.kind === "earn" ? "+" : "−"}
                        {entry.points}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Ամրագրեք տուր, և վճարումից հետո միավորները կերևան այստեղ։
                </p>
              )}
              <Button className="mt-4 rounded-full font-bold" asChild>
                <Link to="/">Ընտրել տուր</Link>
              </Button>
            </section>

            {messages.length > 0 && (
              <section className="rounded-3xl border border-border bg-card p-4">
                <h2 className="text-sm font-bold">Վերջին հաղորդագրություն</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  SMS և WhatsApp · {messages[0]?.status === "sent" ? "ուղարկված" : "չուղարկված"}
                </p>
                <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-muted p-3 font-sans text-xs leading-relaxed">
                  {messages[0]?.body}
                </pre>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
