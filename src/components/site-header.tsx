import { useState } from "react";
import { Menu, Mountain, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Տուրերի օրացույց", href: "#calendar" },
  { label: "Աուդիոգիդեր", href: "#tours" },
  { label: "360° վիրտուալ տուրեր", href: "#tours" },
  { label: "Իմ միավորները", href: "#loyalty" },
];

const languages = ["HY", "EN", "RU"];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("HY");

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a href="#top" className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Mountain className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-extrabold leading-tight tracking-tight">
              Արի Գնանք
            </span>
            <span className="block text-[11px] font-medium text-muted-foreground">
              Մեկօրյա տուրեր Արմավիրից
            </span>
          </span>
        </a>

        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
            >
              {item.label}
            </a>
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
          <Button size="sm" className="rounded-full font-semibold">
            <UserRound className="h-4 w-4" />
            <span className="hidden sm:inline">Մուտք</span>
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
              <a
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-primary-soft"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-2 flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Մուտք հեռախոսահամարով կամ Google-ով — 1 միավոր յուրաքանչյուր 100 ֏-ի դիմաց
          </div>
        </div>
      )}
    </header>
  );
}
