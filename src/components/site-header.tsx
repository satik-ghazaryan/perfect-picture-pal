import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Menu, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminServerSnapshot, getAdminSnapshot, hydrateAdmin, subscribeAdmin } from "@/lib/admin";

const navItems = [
  { label: "Տուրերի օրացույց", to: "/", hash: "calendar" },
  { label: "Աուդիոգիդեր", to: "/", hash: "tours" },
  { label: "360° վիրտուալ տուրեր", to: "/", hash: "tours" },
  { label: "Իմ միավորները", to: "/loyalty" },
] as const;

const languages = ["HY", "EN", "RU"];

export function SiteHeader({ showBack = false }: { showBack?: boolean }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("HY");
  const cashback = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot).settings
    .cashbackPercent;

  useEffect(() => {
    hydrateAdmin();
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        {showBack && (
          <Link
            to="/"
            aria-label="Վերադառնալ գլխավոր էջ"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-primary-soft hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Վերադառնալ</span>
          </Link>
        )}
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-10 w-10 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-base font-extrabold leading-tight tracking-tight">
              Արի Գնանք
            </span>
            <span className="block text-[11px] font-medium text-muted-foreground">
              Մեկօրյա տուրեր Արմավիրից
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              {...("hash" in item ? { hash: item.hash } : {})}
              className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden items-center rounded-full bg-muted p-1 sm:flex">
            {languages.map((code) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
                  lang === code
                    ? "bg-card text-primary shadow-card"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
          <Button size="sm" className="rounded-full font-semibold" asChild>
            <Link to="/guide">
              <UserRound className="h-4 w-4" />
              <span className="hidden sm:inline">Մուտք</span>
            </Link>
          </Button>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-border lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Բացել ընտրացանկը"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-card px-4 py-3 lg:hidden">
          <nav className="flex flex-col">
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                {...("hash" in item ? { hash: item.hash } : {})}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-primary-soft"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/guide"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-primary-soft"
            >
              Ուղեկցորդի մուտք
            </Link>
          </nav>
          <div className="mt-2 flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Արմավիրից ամրագրված յուրաքանչյուր տուրի {cashback}%-ը վերադառնում է միավորներով
          </div>
        </div>
      )}
    </header>
  );
}
