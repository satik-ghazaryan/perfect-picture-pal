import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  CalendarIcon,
  Headphones,
  MessageCircle,
  Phone,
  Rotate3d,
  Search,
  ShieldCheck,
  Sparkles,
  Instagram,
  Facebook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { TourCard } from "@/components/tour-card";
import { regions, tours, tourTypes } from "@/data/tours";
import heroImage from "@/assets/hero-armenia.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Արի Գնանք — Մեկօրյա տուրեր Արմավիրից" },
      {
        name: "description",
        content:
          "Մեկօրյա տուրեր Արմավիրից դեպի Գառնի, Գեղարդ, Սևան, Դիլիջան և Տաթև։ Ամրագրեք ձեր տեղը առցանց։",
      },
      { property: "og:title", content: "Արի Գնանք — Մեկօրյա տուրեր Արմավիրից" },
      {
        property: "og:description",
        content: "Բացահայտեք Հայաստանը մեկ օրում՝ շաբաթավերջի մեկնումներով Արմավիրից։",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function upcomingWeekend() {
  const now = new Date();
  const saturday = new Date(now);
  saturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);
  return { saturday, sunday };
}

function Index() {
  const { saturday, sunday } = useMemo(upcomingWeekend, []);
  const [date, setDate] = useState<Date | undefined>(saturday);
  const [region, setRegion] = useState("all");
  const [type, setType] = useState("all");
  const [day, setDay] = useState<"saturday" | "sunday">("saturday");

  const filtered = tours.filter(
    (t) => (region === "all" || t.region === region) && (type === "all" || t.type === type),
  );
  const weekendTours = tours.filter((t) => t.day === day);

  return (
    <div id="top" className="min-h-screen bg-background font-sans">
      <SiteHeader />

      {/* Hero */}
      <section className="relative">
        <img
          src={heroImage}
          alt="Monastery above an Armenian valley at sunrise"
          width={1920}
          height={1088}
          className="h-[68vh] min-h-[420px] w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy/70 via-navy/50 to-navy/85" />
        <div className="absolute inset-0 flex items-center">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/20 px-3 py-1 text-xs font-bold text-accent ring-1 ring-accent/40">
              <Sparkles className="h-3.5 w-3.5" /> Շաբաթավերջի մեկնումներ Արմավիրից
            </span>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight text-navy-foreground sm:text-6xl">
              Բացահայտիր Հայաստանը
              <br />
              մեկ օրում
            </h1>
            <p className="mt-4 max-w-xl text-sm text-navy-foreground/80 sm:text-base">
              Հնագույն վանքեր, լեռնային լճեր ու անմոռանալի տեսարաններ՝ փոքր խմբերով
              ճանապարհորդություններ, որոնք սկսվում են Արմավիրից։
            </p>
          </div>
        </div>
      </section>

      {/* Search bar */}
      <section className="relative z-10 mx-auto -mt-12 max-w-7xl px-4 sm:px-6">
        <div className="rounded-3xl border border-border bg-card p-3 shadow-float sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_1.2fr_1fr_auto]">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "h-12 w-full justify-start rounded-2xl text-left font-medium",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-4 w-4 text-primary" />
                  {date ? format(date, "d MMM") : "Ընտրեք ամսաթիվը"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  defaultMonth={saturday}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>

            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="!h-12 rounded-2xl font-medium">
                <SelectValue placeholder="Ուղղություն" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Բոլոր ուղղությունները</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="!h-12 rounded-2xl font-medium">
                <SelectValue placeholder="Տուրի տեսակ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Բոլոր տեսակները</SelectItem>
                {tourTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button className="h-12 rounded-2xl px-8 text-sm font-bold">
              <Search className="h-4 w-4" />
              Որոնել
            </Button>
          </div>
        </div>
      </section>

      {/* Weekend calendar widget */}
      <section id="calendar" className="mx-auto max-w-7xl px-4 pt-12 sm:px-6">
        <div className="rounded-3xl bg-navy p-5 text-navy-foreground sm:p-7">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold sm:text-2xl">Այս շաբաթավերջին</h2>
              <p className="text-xs text-navy-foreground/70 sm:text-sm">
                Հաստատված մեկնումներ՝ {format(saturday, "d MMM")} – {format(sunday, "d MMM")}
              </p>
            </div>
            <div className="flex shrink-0 rounded-full bg-navy-foreground/10 p-1">
              {(["saturday", "sunday"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDay(d)}
                  className={cn(
                    "rounded-full px-4 py-2 text-xs font-bold capitalize transition-colors sm:text-sm",
                    day === d
                      ? "bg-accent text-accent-foreground"
                      : "text-navy-foreground/70 hover:text-navy-foreground",
                  )}
                >
                    {d === "saturday" ? "Շբ" : "Կիր"} {format(d === "saturday" ? saturday : sunday, "d")}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {weekendTours.map((t) => (
              <div
                key={t.id}
                className="rounded-2xl bg-navy-foreground/10 p-4 ring-1 ring-navy-foreground/10"
              >
                <p className="truncate text-sm font-bold">{t.title}</p>
                <p className="mt-1 text-xs text-navy-foreground/70">
                  {t.departureTime} · {t.departurePlace}
                </p>
                <p className="mt-3 text-sm font-extrabold text-accent">
                  Մնացել է {t.seatsLeft} տեղ
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tours grid */}
      <section id="tours" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              Առաջարկվող մեկօրյա տուրեր
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Գտնվել է {filtered.length} տուր
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <Rotate3d className="h-4 w-4 text-primary" /> 360° դիտում
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Headphones className="h-4 w-4 text-primary" /> Աուդիոգիդեր
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tour) => (
            <TourCard key={tour.id} tour={tour} />
          ))}
        </div>
      </section>

      {/* Loyalty strip */}
      <section id="loyalty" className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
        <div className="grid gap-4 rounded-3xl bg-primary-soft p-6 sm:grid-cols-3">
          {[
            { icon: Sparkles, title: "Հավատարմության միավորներ", text: "Ստացեք 1 միավոր յուրաքանչյուր 100 ֏-ի դիմաց։" },
            { icon: ShieldCheck, title: "Անվճար չեղարկում", text: "Չեղարկեք մեկնումից մինչև 24 ժամ առաջ։" },
            { icon: Headphones, title: "Գիդեր 3 լեզվով", text: "Հայերեն, անգլերեն և ռուսերեն։" },
          ].map((item) => (
            <div key={item.title} className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card text-primary">
                <item.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy text-navy-foreground">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <p className="text-base font-extrabold">Արի Գնանք</p>
            <p className="mt-2 text-xs text-navy-foreground/70">
              Մեկօրյա տուրեր Արմավիրից՝ տարվա յուրաքանչյուր շաբաթավերջին։
            </p>
            <div className="mt-4 flex gap-2">
              {[Instagram, Facebook, MessageCircle].map((Icon, i) => (
                <a
                  key={i}
                  href="#top"
                  className="grid h-9 w-9 place-items-center rounded-full bg-navy-foreground/10 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-bold">Բացահայտեք</p>
            <ul className="mt-3 space-y-2 text-xs text-navy-foreground/70">
              <li><a href="#calendar" className="hover:text-accent">Տուրերի օրացույց</a></li>
              <li><a href="#tours" className="hover:text-accent">Աուդիոգիդեր</a></li>
              <li><a href="#tours" className="hover:text-accent">360° վիրտուալ տուրեր</a></li>
              <li><a href="#loyalty" className="hover:text-accent">Հավատարմության միավորներ</a></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold">Օգտակար տեղեկություն</p>
            <ul className="mt-3 space-y-2 text-xs text-navy-foreground/70">
              <li><a href="#top" className="hover:text-accent">Չեղարկման պայմաններ</a></li>
              <li><a href="#top" className="hover:text-accent">Օգտագործման պայմաններ</a></li>
              <li><a href="#top" className="hover:text-accent">Գաղտնիության քաղաքականություն</a></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold">Կապ մեզ հետ</p>
            <ul className="mt-3 space-y-2 text-xs text-navy-foreground/70">
              <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> +374 10 000 000</li>
              <li className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp / Viber</li>
              <li>Կենտրոնական հրապարակ, Արմավիր</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-navy-foreground/10 px-4 py-5 text-center text-[11px] text-navy-foreground/60">
          © {new Date().getFullYear()} Արի Գնանք։ Բոլոր իրավունքները պաշտպանված են։
        </div>
      </footer>
    </div>
  );
}
