import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Sparkles, UserRound, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  getTouristServerSnapshot,
  getTouristSnapshot,
  hydrateAdmin,
  signOutTourist,
  subscribeAdmin,
  subscribeTourist,
} from "@/lib/admin";
import { setSiteLocale, useSiteLocale, type LocaleCode } from "@/lib/locale";

const navItems = [
  { label: "Տուրերի օրացույց", to: "/", hash: "calendar" },
  { label: "Աուդիոգիդեր", to: "/", hash: "tours" },
  { label: "360° Վիրտուալ Տուրեր", to: "/virtual" },
] as const;

const languages: { code: LocaleCode; label: string }[] = [
  { code: "hy", label: "HY" },
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
];

function initial(name: string) {
  const letter = name.trim().charAt(0);
  return letter || "•";
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const lang = useSiteLocale();
  const cashback = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot).settings
    .cashbackPercent;
  const tourist = useSyncExternalStore(subscribeTourist, getTouristSnapshot, getTouristServerSnapshot);
  const path = useRouterState({ select: (state) => state.location.href });
  const redirect = path.startsWith("/login") ? "/" : path;
  const staffHome = tourist?.role === "guide" ? "/guide" : tourist?.role === "driver" ? "/driver" : null;

  useEffect(() => {
    hydrateAdmin();
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={staffHome ?? "/"} className="flex min-w-0 items-center gap-2.5">
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

          {!staffHome && (
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
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center rounded-full bg-muted p-1 sm:flex">
            {languages.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                onClick={() => setSiteLocale(code)}
                className={`rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
                  lang === code
                    ? "bg-card text-primary shadow-card"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tourist ? (
            <div className="flex items-center gap-2">
              {tourist.role === "tourist" ? (
                <Button size="sm" variant="outline" className="h-9 rounded-full px-2 font-semibold" asChild>
                  <Link to="/profile">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="bg-primary-soft text-[10px] font-bold text-primary">
                        {initial(tourist.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="max-w-28 truncate sm:max-w-40">{tourist.fullName}</span>
                  </Link>
                </Button>
              ) : (
                <span className="hidden max-w-36 truncate text-sm font-semibold sm:inline">{tourist.fullName}</span>
              )}
              <Button size="sm" variant="outline" className="rounded-full font-semibold" onClick={() => signOutTourist()}>
                Ելք
              </Button>
            </div>
          ) : (
            <Button size="sm" className="rounded-full font-semibold" asChild>
              <Link to="/login" search={{ redirect }}>
                <UserRound className="h-4 w-4" />
                <span className="hidden sm:inline">Մուտք</span>
              </Link>
            </Button>
          )}
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
            {!staffHome && navItems.map((item) => (
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
            {tourist ? (
              <>
                {tourist.role === "tourist" && (
                  <Link
                    to="/profile"
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-primary-soft"
                  >
                    {tourist.fullName}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    signOutTourist();
                    setOpen(false);
                  }}
                  className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-primary-soft"
                >
                  Ելք
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  search={{ redirect }}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-primary-soft"
                >
                  Մուտք
                </Link>
                <Link
                  to="/login"
                  search={{ redirect: "/guide" }}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-primary-soft"
                >
                  Զբոսավարի մուտք
                </Link>
                <Link
                  to="/login"
                  search={{ redirect: "/driver" }}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-primary-soft"
                >
                  Վարորդի մուտք
                </Link>
              </>
            )}
          </nav>
          <div className="mt-2 flex items-center gap-1 px-3 sm:hidden">
            {languages.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                onClick={() => setSiteLocale(code)}
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  lang === code ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Արմավիրից ամրագրված յուրաքանչյուր տուրի {cashback}%-ը վերադառնում է միավորներով
          </div>
        </div>
      )}
    </header>
  );
}
