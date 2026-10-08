import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { hy } from "date-fns/locale";
import { toast } from "sonner";
import { CalendarDays, ChevronDown, ChevronUp, FileSpreadsheet, LogOut, Plus, Rotate3d, Settings, Ticket, Trash2, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmd, regions, tourTypes, type AudioChapter, type AudioLanguage, type Tour } from "@/data/tours";
import { columnsToLocalized, emptyLocalized, tourLocation, tourTitle, trimLocalized, type LocaleCode, type LocalizedText } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  assignStaff,
  deleteTour,
  getAdminServerSnapshot,
  getAdminSnapshot,
  loadAdminBookings,
  createStaffAccount,
  updateDirectoryUser,
  loadDirectory,
  saveSettings,
  saveTour,
  signOutAdmin,
  subscribeAdmin,
  type AdminSession,
  type DirectoryUser,
  type ManagedTour,
  type SiteSettings,
} from "@/lib/admin";
import { getPortalServerSnapshot, getPortalSnapshot, subscribePortal, upcomingDepartureDate, type AssignedTour, type BookingRecord } from "@/lib/guide-api";
import {
  adjustLoyaltyPoints,
  getLoyaltyServerSnapshot,
  getLoyaltySnapshot,
  hydrateLoyalty,
  loadLoyalty,
  phoneKey,
  subscribeLoyalty,
} from "@/lib/loyalty";
import { downloadPassengerWorkbook } from "@/lib/passenger-export";
import { isSupabaseConfigured } from "@/lib/supabase";

const sections = [
  { id: "tours", label: "Տուրեր", icon: CalendarDays },
  { id: "virtual", label: "360° Վիրտուալ Տուրեր", icon: Rotate3d },
  { id: "staff", label: "Զբոսավարներ և Վարորդներ", icon: Users },
  { id: "tourists", label: "Զբոսաշրջիկներ", icon: UserRound },
  { id: "bookings", label: "Ամրագրումներ", icon: Ticket },
  { id: "settings", label: "Կարգավորումներ", icon: Settings },
] as const;

type SectionId = (typeof sections)[number]["id"];

const paymentLabel = {
  idram: "Idram",
  telcell: "Telcell",
  arca: "ArCa",
} as const;

const paymentStatusLabel = {
  SUCCESS: "Վճարված",
  PENDING: "Սպասում",
  FAILED: "Չհաջողված",
} as const;

type ChapterDraft = {
  id: string;
  title: string;
  audioUrl: string;
  duration: string;
  language: AudioLanguage;
};

const formLanguages: { code: LocaleCode; label: string }[] = [
  { code: "hy", label: "HY (Հայերեն)" },
  { code: "en", label: "EN (English)" },
  { code: "ru", label: "RU (Русский)" },
];

type Draft = {
  id: string | null;
  title: LocalizedText;
  price: string;
  seats: string;
  departureTime: string;
  returnTime: string;
  day: Tour["day"];
  region: LocalizedText;
  type: Tour["type"];
  summary: LocalizedText;
  image: string;
  panoramaUrl: string;
  virtualTourUrl: string;
  virtualTourId: string;
  isVirtualOnly: boolean;
  itinerary: string;
  chapters: ChapterDraft[];
};

const chapterLanguages: { value: AudioLanguage; label: string }[] = [
  { value: "hy", label: "HY · Հայերեն" },
  { value: "en", label: "EN · English" },
  { value: "ru", label: "RU · Русский" },
];

function emptyDraft(virtualOnly = false): Draft {
  return {
    id: null,
    title: emptyLocalized(),
    price: "",
    seats: "12",
    departureTime: "08:30",
    returnTime: "19:00",
    day: "saturday",
    region: regions[0] ? { ...regions[0] } : emptyLocalized(),
    type: "Մշակութային",
    summary: emptyLocalized(),
    image: "",
    panoramaUrl: "",
    virtualTourUrl: "",
    virtualTourId: "",
    isVirtualOnly: virtualOnly,
    itinerary: "",
    chapters: [],
  };
}

function draftFromTour(tour: ManagedTour): Draft {
  return {
    id: tour.id,
    title: columnsToLocalized(tour.title_hy, tour.title_en, tour.title_ru),
    price: String(tour.price),
    seats: String(tour.seatsLeft),
    departureTime: tour.departureTime,
    returnTime: tour.returnTime,
    day: tour.day,
    region: columnsToLocalized(tour.location_hy, tour.location_en, tour.location_ru),
    type: tour.type,
    summary: columnsToLocalized(tour.description_hy, tour.description_en, tour.description_ru),
    image: tour.image_url,
    panoramaUrl: tour.panoramaUrl,
    virtualTourUrl: tour.virtual_tour_url || tour.panoramaUrl || "",
    virtualTourId: tour.virtual_tour_id ?? "",
    isVirtualOnly: tour.is_virtual_only === true,
    itinerary: tour.itinerary.map((stop) => `${stop.time} | ${stop.title} | ${stop.description}`).join("\n"),
    chapters: tour.audioChapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      audioUrl: chapter.audioUrl ?? "",
      duration: formatClock(chapter.duration),
      language: chapter.language ?? "hy",
    })),
  };
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseClock(value: string) {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  const total = minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function blankChapter(): ChapterDraft {
  return {
    id: crypto.randomUUID(),
    title: "",
    audioUrl: "",
    duration: "03:00",
    language: "hy",
  };
}

function chaptersToSave(chapters: ChapterDraft[], tourId: string): AudioChapter[] | null {
  const saved: AudioChapter[] = [];
  for (const [index, chapter] of chapters.entries()) {
    const title = chapter.title.trim();
    const audioUrl = chapter.audioUrl.trim();
    const untouched = !title && !audioUrl && chapter.duration === "03:00";
    if (untouched) continue;
    if (!title) return null;
    const duration = parseClock(chapter.duration);
    if (duration === null) return null;
    const next: AudioChapter = {
      id: chapter.id || `${tourId}-a${index + 1}`,
      title,
      duration,
      language: chapter.language,
    };
    if (audioUrl) next.audioUrl = audioUrl;
    saved.push(next);
  }
  return saved;
}

function parseItinerary(raw: string) {
  return raw.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const parts = trimmed.split("|").map((part) => part.trim());
    const time = parts[0] ?? "";
    const title = parts[1] || trimmed;
    const description = parts[2] ?? "";
    if (!time) return [];
    return [{ time, title, description }];
  });
}

function nextId(title: string, existing: ManagedTour[]) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  const base = slug.length >= 3 ? slug : `tour-${Date.now().toString(36)}`;
  let id = base;
  let suffix = 2;
  while (existing.some((tour) => tour.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function AdminDashboard({ session }: { session: AdminSession }) {
  const catalog = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot);
  const portal = useSyncExternalStore(subscribePortal, getPortalSnapshot, getPortalServerSnapshot);
  const [section, setSection] = useState<SectionId>("tours");
  const [remoteUsers, setRemoteUsers] = useState<DirectoryUser[]>([]);
  const [staffError, setStaffError] = useState("");
  const [remoteBookings, setRemoteBookings] = useState(portal.bookings);
  const [bookingError, setBookingError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) return;
    loadDirectory()
      .then((rows) => {
        if (!cancelled) setRemoteUsers(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setStaffError(error instanceof Error ? error.message : "Անձնակազմը չբեռնվեց։");
      });
    loadAdminBookings()
      .then((rows) => {
        if (!cancelled) setRemoteBookings(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setBookingError(error instanceof Error ? error.message : "Ամրագրումները չբեռնվեցին։");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bookings = isSupabaseConfigured ? remoteBookings : portal.bookings;
  const revenue = bookings
    .filter((booking) => booking.paymentStatus === "SUCCESS")
    .reduce((sum, booking) => sum + booking.amount, 0);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-8">
      <aside className="rounded-3xl border border-border bg-card p-3 lg:sticky lg:top-24 lg:self-start">
        <p className="px-3 pt-2 text-xs font-semibold text-muted-foreground">Ադմին պորտալ</p>
        <p className="px-3 pb-3 text-sm font-black">{session.fullName}</p>
        <nav className="flex gap-2 overflow-x-auto lg:flex-col">
          {sections.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold ${
                  active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-primary-soft"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <Button type="button" variant="outline" className="mt-3 w-full rounded-full" onClick={() => void signOutAdmin()}>
          <LogOut className="h-4 w-4" />
          Ելք
        </Button>
      </aside>

      <div className="min-w-0 space-y-4">
        {!isSupabaseConfigured && (
          <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-foreground">
            Տեղային նախադիտում. փոփոխությունները պահվում են այս դիտարկիչում։
          </p>
        )}
        {section === "tours" && <ToursSection tours={catalog.tours} mode="departures" />}
        {section === "virtual" && <ToursSection tours={catalog.tours} mode="virtual" />}
        {section === "staff" && (
          <StaffSection
            tours={catalog.tours.filter((tour) => tour.is_virtual_only !== true)}
            users={isSupabaseConfigured ? remoteUsers : catalog.users}
            error={staffError}
            onSaved={async () => {
              if (!isSupabaseConfigured) return;
              setRemoteUsers(await loadDirectory());
            }}
          />
        )}
        {section === "tourists" && (
          <TouristsSection
            users={isSupabaseConfigured ? remoteUsers : catalog.users}
            tours={catalog.tours}
            portalTours={portal.tours}
            bookings={bookings}
          />
        )}
        {section === "bookings" && (
          <BookingsSection
            tours={catalog.tours}
            users={isSupabaseConfigured ? remoteUsers : catalog.users}
            bookings={bookings}
            revenue={revenue}
            error={bookingError}
          />
        )}
        {section === "settings" && <SettingsSection settings={catalog.settings} />}
      </div>
    </div>
  );
}

function AudioChapterManager({
  chapters,
  onChange,
}: {
  chapters: ChapterDraft[];
  onChange: (chapters: ChapterDraft[]) => void;
}) {
  const patch = (id: string, next: Partial<ChapterDraft>) => {
    onChange(chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...next } : chapter)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const current = chapters[index];
    const neighbor = chapters[target];
    if (!current || !neighbor) return;
    const next = [...chapters];
    next[index] = neighbor;
    next[target] = current;
    onChange(next);
  };

  return (
    <section className="space-y-3 rounded-3xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black">Աուդիոգիդի Գլուխներ</h3>
          <p className="mt-1 text-xs text-muted-foreground">Ավելացրեք, խմբագրեք, վերադասավորեք կամ հանեք գլուխները։</p>
        </div>
        <Button type="button" variant="outline" className="rounded-full" onClick={() => onChange([...chapters, blankChapter()])}>
          <Plus className="h-4 w-4" />
          Ավելացնել գլուխ
        </Button>
      </div>
      {chapters.length === 0 && (
        <p className="rounded-2xl bg-card px-3 py-4 text-sm text-muted-foreground">Գլուխներ դեռ չկան։</p>
      )}
      {chapters.map((chapter, index) => (
        <article key={chapter.id} className="space-y-3 rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-muted-foreground">Գլուխ {index + 1}</p>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="icon" className="rounded-full" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Տեղափոխել վերև">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="rounded-full" disabled={index === chapters.length - 1} onClick={() => move(index, 1)} aria-label="Տեղափոխել ներքև">
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => onChange(chapters.filter((item) => item.id !== chapter.id))} aria-label="Հեռացնել գլուխը">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Վերնագիր" id={`chapter-title-${chapter.id}`}>
              <Input
                id={`chapter-title-${chapter.id}`}
                value={chapter.title}
                onChange={(event) => patch(chapter.id, { title: event.target.value })}
                placeholder="Գառնիի տաճարի պատմությունը"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Տևողություն" id={`chapter-duration-${chapter.id}`}>
              <Input
                id={`chapter-duration-${chapter.id}`}
                value={chapter.duration}
                onChange={(event) => patch(chapter.id, { duration: event.target.value })}
                placeholder="03:45"
                inputMode="numeric"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Ֆայլի հղում/MP3" id={`chapter-url-${chapter.id}`}>
              <Input
                id={`chapter-url-${chapter.id}`}
                value={chapter.audioUrl}
                onChange={(event) => patch(chapter.id, { audioUrl: event.target.value })}
                placeholder="/audio/garni-1.mp3"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Լեզու" id={`chapter-lang-${chapter.id}`}>
              <Select value={chapter.language} onValueChange={(language) => patch(chapter.id, { language: language as AudioLanguage })}>
                <SelectTrigger id={`chapter-lang-${chapter.id}`} className="rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chapterLanguages.map((language) => (
                    <SelectItem key={language.value} value={language.value}>{language.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </article>
      ))}
    </section>
  );
}

function missingCopy(draft: Draft, code: LocaleCode) {
  return !draft.title[code].trim() || !draft.summary[code].trim() || !draft.region[code].trim();
}

function ToursSection({ tours, mode }: { tours: ManagedTour[]; mode: "departures" | "virtual" }) {
  const listed = tours.filter((tour) => (mode === "virtual" ? tour.is_virtual_only === true : tour.is_virtual_only !== true));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formLang, setFormLang] = useState<LocaleCode>("hy");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async () => {
    if (!draft) return;
    const title = trimLocalized(draft.title);
    const virtualOnly = mode === "virtual";
    const price = virtualOnly ? 0 : Math.round(Number(draft.price));
    const seats = virtualOnly ? 0 : Math.round(Number(draft.seats));
    if (title.hy.length < 2) {
      setFormLang("hy");
      toast.error("Հայերեն վերնագիրը պարտադիր է։");
      return;
    }
    if (!virtualOnly && (!Number.isFinite(price) || price <= 0 || !Number.isFinite(seats) || seats <= 0)) {
      toast.error("Գինը և տեղերը պետք է դրական թիվ լինեն։");
      return;
    }
    const existing = draft.id ? tours.find((tour) => tour.id === draft.id) : undefined;
    const id = draft.id ?? nextId(title.hy, tours);
    const audio = virtualOnly ? [] : chaptersToSave(draft.chapters, id);
    if (!audio) {
      toast.error("Լրացրեք գլխի վերնագիրը, իսկ տևողությունը գրեք MM:SS ձևաչափով։");
      return;
    }
    const virtualLink = draft.virtualTourUrl.trim();
    const panoramaUrl = virtualOnly
      ? (/\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(virtualLink) ? virtualLink : "")
      : existing?.panoramaUrl ?? "";
    const virtualTourUrl = virtualOnly ? virtualLink : existing?.virtual_tour_url?.trim() ?? "";
    const linkedVirtual = !virtualOnly
      ? tours.find((item) => item.id === draft.virtualTourId && item.is_virtual_only === true && item.id !== id)
      : undefined;
    const image = draft.image.trim() || (virtualOnly ? "" : existing?.image_url || tours[0]?.image_url || "");
    if (!image) {
      toast.error("Ավելացրեք նկարի հղում։");
      return;
    }
    const description = trimLocalized(draft.summary);
    const location = trimLocalized(draft.region);
    const next: ManagedTour = {
      id,
      title_hy: title.hy,
      title_en: title.en,
      title_ru: title.ru,
      description_hy: description.hy,
      description_en: description.en,
      description_ru: description.ru,
      location_hy: location.hy,
      location_en: location.en,
      location_ru: location.ru,
      image_url: image,
      category: location.hy,
      type: draft.type,
      departurePlace: virtualOnly ? "" : getAdminSnapshot().settings.departurePlace,
      departureTime: virtualOnly ? "" : draft.departureTime || "08:30",
      returnTime: virtualOnly ? "" : draft.returnTime || "19:00",
      price,
      seatsLeft: seats,
      rating: existing?.rating ?? 5,
      reviews: existing?.reviews ?? 0,
      has360: panoramaUrl.length > 0 || virtualTourUrl.length > 0 || virtualOnly || existing?.has360 === true,
      hasAudioGuide: audio.length > 0,
      day: virtualOnly ? "saturday" : draft.day,
      highlights: virtualOnly ? [] : existing?.highlights ?? [],
      itinerary: virtualOnly ? [] : parseItinerary(draft.itinerary),
      included: virtualOnly ? [] : existing?.included ?? ["Հարմարավետ ավտոբուս Արմավիրից և վերադարձ", "Հայախոս ուղեկցորդ"],
      excluded: virtualOnly ? [] : existing?.excluded ?? ["Ճաշ և անձնական ծախսեր"],
      audioChapters: audio,
      hotspots: existing?.hotspots ?? [],
      panoramaUrl,
      is_virtual_only: virtualOnly,
      virtual_tour_id: linkedVirtual?.id ?? null,
      guideId: existing?.guideId ?? null,
      driverId: existing?.driverId ?? null,
    };
    if (existing?.oldPrice !== undefined) next.oldPrice = existing.oldPrice;
    if (virtualTourUrl) next.virtual_tour_url = virtualTourUrl;
    setSaving(true);
    try {
      await saveTour(next);
      toast.success(draft.id ? "Տուրը թարմացվեց" : "Տուրը ավելացվեց");
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Չպահպանվեց։");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tourId: string) => {
    try {
      await deleteTour(tourId);
      toast.success("Տուրը ջնջվեց");
      setConfirmId(null);
      if (draft?.id === tourId) setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Չջնջվեց։");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{mode === "virtual" ? "360° Վիրտուալ Տուրեր" : "Տուրեր"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "virtual"
              ? "Առանձին վիրտուալ տուրեր՝ առանց մեկնման և ամրագրման"
              : "Արմավիրից մեկնող մեկօրյա տուրեր"}
          </p>
        </div>
        <Button type="button" className="rounded-full font-bold" onClick={() => { setFormLang("hy"); setDraft(emptyDraft(mode === "virtual")); }}>
          <Plus className="h-4 w-4" />
          {mode === "virtual" ? "Նոր վիրտուալ տուր" : "Նոր տուր"}
        </Button>
      </div>

      {listed.length === 0 && (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {mode === "virtual" ? "Վիրտուալ տուրեր դեռ չկան։" : "Մեկնող տուրեր դեռ չկան։"}
        </p>
      )}

      <div className="space-y-3">
        {listed.map((tour) => {
          const linkedTitle = tour.is_virtual_only
            ? ""
            : tours.find((item) => item.id === tour.virtual_tour_id && item.is_virtual_only)?.title_hy ?? "";
          return (
          <article key={tour.id} className="rounded-3xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-snug">{tourTitle(tour)}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tour.is_virtual_only ? tourLocation(tour) : `${formatAmd(tour.price)} · ${tour.seatsLeft} տեղ · ${tour.departureTime}`}
                  {tour.virtual_tour_url ? " · 360° հղում" : ""}
                  {linkedTitle ? ` · 360°՝ ${linkedTitle}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-full" asChild>
                  <Link to="/tours/$id" params={{ id: tour.id }}>Դիտել</Link>
                </Button>
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => { setFormLang("hy"); setDraft(draftFromTour(tour)); }}>
                  Խմբագրել
                </Button>
                {confirmId === tour.id ? (
                  <Button type="button" variant="destructive" size="sm" className="rounded-full" onClick={() => void remove(tour.id)}>
                    Հաստատել ջնջումը
                  </Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setConfirmId(tour.id)}>
                    Ջնջել
                  </Button>
                )}
              </div>
            </div>
          </article>
          );
        })}
      </div>

      {draft && (
        <form
          className="space-y-4 rounded-3xl border border-border bg-card p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 className="text-lg font-black">
            {mode === "virtual"
              ? draft.id ? "Խմբագրել վիրտուալ տուրը" : "Նոր վիրտուալ տուր"
              : draft.id ? "Խմբագրել տուրը" : "Նոր տուր"}
          </h2>
          <div className="space-y-4 rounded-2xl border border-border bg-muted/40 p-3 sm:p-4">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Լեզու">
              {formLanguages.map(({ code, label }) => {
                const missing = missingCopy(draft, code);
                const active = formLang === code;
                return (
                  <button
                    key={code}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFormLang(code)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                      active ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
                      missing && "ring-2 ring-amber-500",
                    )}
                  >
                    {label}
                    {missing && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Վերնագիր" id={`tour-title-${formLang}`}>
                <Input
                  id={`tour-title-${formLang}`}
                  value={draft.title[formLang]}
                  onChange={(event) => update({ title: { ...draft.title, [formLang]: event.target.value } })}
                  className="rounded-2xl"
                />
              </Field>
              <Field label="Վայր" id={`tour-region-${formLang}`}>
                <Input
                  id={`tour-region-${formLang}`}
                  value={draft.region[formLang]}
                  onChange={(event) => update({ region: { ...draft.region, [formLang]: event.target.value } })}
                  className="rounded-2xl"
                />
              </Field>
            </div>
            <Field label="Նկարագրություն" id={`tour-summary-${formLang}`}>
              <Textarea
                id={`tour-summary-${formLang}`}
                value={draft.summary[formLang]}
                onChange={(event) => update({ summary: { ...draft.summary, [formLang]: event.target.value } })}
                className="min-h-20 rounded-2xl"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === "departures" && (
              <>
                <Field label="Գին (֏)" id="tour-price">
                  <Input id="tour-price" inputMode="numeric" value={draft.price} onChange={(event) => update({ price: event.target.value })} className="rounded-2xl" />
                </Field>
                <Field label="Տեղեր" id="tour-seats">
                  <Input id="tour-seats" inputMode="numeric" value={draft.seats} onChange={(event) => update({ seats: event.target.value })} className="rounded-2xl" />
                </Field>
                <Field label="Մեկնում" id="tour-time">
                  <Input id="tour-time" type="time" value={draft.departureTime} onChange={(event) => update({ departureTime: event.target.value })} className="rounded-2xl" />
                </Field>
                <Field label="Վերադարձ" id="tour-return">
                  <Input id="tour-return" type="time" value={draft.returnTime} onChange={(event) => update({ returnTime: event.target.value })} className="rounded-2xl" />
                </Field>
                <Field label="Օր" id="tour-day">
                  <Select value={draft.day} onValueChange={(day) => update({ day: day === "sunday" ? "sunday" : "saturday" })}>
                    <SelectTrigger id="tour-day" className="rounded-2xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="saturday">Շաբաթ</SelectItem>
                      <SelectItem value="sunday">Կիրակի</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}
            <Field label="Տեսակ" id="tour-type">
              <Select value={draft.type} onValueChange={(type) => update({ type: type as Tour["type"] })}>
                <SelectTrigger id="tour-type" className="rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tourTypes.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Նկարի հղում" id="tour-image">
            <Input id="tour-image" value={draft.image} onChange={(event) => update({ image: event.target.value })} placeholder="https://..." className="rounded-2xl" />
          </Field>
          {mode === "departures" && (
            <Field label="360° Վիրտուալ Տուր" id="tour-virtual-link">
              <Select
                value={tours.some((item) => item.id === draft.virtualTourId && item.is_virtual_only) ? draft.virtualTourId : "none"}
                onValueChange={(value) => update({ virtualTourId: value === "none" ? "" : value })}
              >
                <SelectTrigger id="tour-virtual-link" className="rounded-2xl">
                  <SelectValue placeholder="Առանց վիրտուալ տուրի" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Առանց վիրտուալ տուրի</SelectItem>
                  {tours
                    .filter((item) => item.is_virtual_only === true)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>{tourTitle(item)}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {mode === "virtual" && (
            <Field label="360° պանորամայի / iframe հղում" id="tour-virtual-url">
              <Input
                id="tour-virtual-url"
                value={draft.virtualTourUrl}
                onChange={(event) => update({ virtualTourUrl: event.target.value })}
                placeholder="https://… պանորամա կամ iframe"
                className="rounded-2xl"
              />
            </Field>
          )}
          {mode === "departures" && (
            <>
              <Field label="Ծրագիր (ժամ | վերնագիր | նկարագրություն)" id="tour-itinerary">
                <Textarea id="tour-itinerary" value={draft.itinerary} onChange={(event) => update({ itinerary: event.target.value })} className="min-h-32 rounded-2xl" placeholder={"08:30 | Մեկնում Արմավիրից | Հավաք Կենտրոնական հրապարակում"} />
              </Field>
              <AudioChapterManager
                chapters={draft.chapters}
                onChange={(chapters) => update({ chapters })}
              />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="rounded-full font-bold" disabled={saving}>
              {saving ? "Պահվում է" : "Պահպանել"}
            </Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setDraft(null)}>
              Փակել
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

type StaffDraft = {
  id: string | null;
  role: "guide" | "driver";
  fullName: string;
  phone: string;
  email: string;
  password: string;
  avatarUrl: string;
  bio: string;
};

const emptyStaffDraft: StaffDraft = {
  id: null,
  role: "guide",
  fullName: "",
  phone: "",
  email: "",
  password: "",
  avatarUrl: "",
  bio: "",
};

function StaffEditor({
  draft,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: StaffDraft;
  saving: boolean;
  onChange: (next: StaffDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const editing = draft.id !== null;
  return (
    <form
      className="space-y-3 rounded-3xl border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field label="Դեր" id="staff-role">
        <Select
          value={draft.role}
          onValueChange={(value) => {
            if (value === "guide" || value === "driver") onChange({ ...draft, role: value });
          }}
        >
          <SelectTrigger id="staff-role" className="rounded-2xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="guide">Զբոսավար</SelectItem>
            <SelectItem value="driver">Վարորդ</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Անուն Ազգանուն" id="staff-name">
          <Input id="staff-name" value={draft.fullName} onChange={(event) => onChange({ ...draft, fullName: event.target.value })} className="rounded-2xl" />
        </Field>
        <Field label="Հեռախոս" id="staff-phone">
          <Input id="staff-phone" value={draft.phone} onChange={(event) => onChange({ ...draft, phone: event.target.value })} className="rounded-2xl" />
        </Field>
        <Field label="Էլ. փոստ" id="staff-email">
          <Input id="staff-email" type="email" value={draft.email} onChange={(event) => onChange({ ...draft, email: event.target.value })} className="rounded-2xl" />
        </Field>
        <Field label="Գաղտնաբառ" id="staff-password">
          <Input
            id="staff-password"
            type="password"
            value={draft.password}
            onChange={(event) => onChange({ ...draft, password: event.target.value })}
            placeholder={editing ? "Թողեք դատարկ, եթե չեք փոխում" : ""}
            className="rounded-2xl"
          />
        </Field>
      </div>
      <Field label="Նկարի հղում" id="staff-avatar">
        <Input id="staff-avatar" value={draft.avatarUrl} onChange={(event) => onChange({ ...draft, avatarUrl: event.target.value })} placeholder="https://…" className="rounded-2xl" />
      </Field>
      <Field label="Համառոտ նկարագրություն" id="staff-bio">
        <Textarea id="staff-bio" value={draft.bio} onChange={(event) => onChange({ ...draft, bio: event.target.value })} className="min-h-20 rounded-2xl" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="rounded-full font-bold" disabled={saving}>
          {saving ? "Պահվում է" : editing ? "Պահպանել" : "Ստեղծել հաշիվ"}
        </Button>
        {editing && (
          <Button type="button" variant="outline" className="rounded-full" onClick={onCancel}>
            Չեղարկել
          </Button>
        )}
      </div>
    </form>
  );
}

function StaffSection({
  tours,
  users,
  error,
  onSaved,
}: {
  tours: ManagedTour[];
  users: DirectoryUser[];
  error: string;
  onSaved: () => Promise<void>;
}) {
  const guides = users.filter((member) => member.role === "guide");
  const drivers = users.filter((member) => member.role === "driver");
  const [draft, setDraft] = useState<StaffDraft>(emptyStaffDraft);
  const [savingStaff, setSavingStaff] = useState(false);

  const handleEditStaff = (member: DirectoryUser) => {
    if (member.role !== "guide" && member.role !== "driver") return;
    setDraft({
      id: member.id,
      role: member.role,
      fullName: member.fullName,
      phone: member.phone,
      email: member.email,
      password: "",
      avatarUrl: member.avatarUrl,
      bio: member.bio,
    });
  };

  const saveStaff = async () => {
    setSavingStaff(true);
    try {
      const role = draft.role === "driver" ? "driver" : "guide";
      if (draft.id) {
        const current = users.find((member) => member.id === draft.id);
        if (!current) throw new Error("Անձնակազմի հաշիվը չի գտնվել։");
        const password = draft.password.trim() || current.password;
        if (draft.password.trim() && draft.password.trim().length < 4) {
          throw new Error("Գաղտնաբառը առնվազն 4 նիշ պետք է լինի։");
        }
        await updateDirectoryUser({
          ...current,
          role,
          fullName: draft.fullName,
          phone: draft.phone,
          email: draft.email,
          password,
          avatarUrl: draft.avatarUrl,
          bio: draft.bio,
        });
        setDraft(emptyStaffDraft);
        await onSaved();
        toast.success("Տվյալները պահվեցին");
      } else {
        await createStaffAccount({ ...draft, role });
        setDraft(emptyStaffDraft);
        await onSaved();
        toast.success("Անձնակազմի հաշիվը ստեղծվեց");
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Հաշիվը չպահվեց։");
    } finally {
      setSavingStaff(false);
    }
  };

  const change = async (tourId: string, guideId: string | null, driverId: string | null) => {
    try {
      await assignStaff(tourId, guideId, driverId);
      toast.success("Նշանակումը պահվեց");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Նշանակումը չպահվեց։");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Զբոսավարներ և Վարորդներ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ստեղծեք զբոսավարի կամ վարորդի հաշիվ, ապա նշանակեք նրան կոնկրետ մեկնման։
        </p>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <section className="space-y-4 rounded-3xl border border-border bg-card p-4 sm:p-6">
        <div className="border-b border-border pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Անձնակազմի հաշիվներ</p>
          <h2 className="mt-1 text-xl font-black tracking-tight">1. Նոր զբոսավար կամ վարորդ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Հաշիվը ստեղծվում է ընտրված դերով։ Նկարը, հեռախոսը և նկարագրությունը երևում են զբոսաշրջիկին մեկնումից մեկ օր առաջ։
          </p>
        </div>
        <StaffEditor
          draft={draft}
          saving={savingStaff}
          onChange={setDraft}
          onSubmit={() => void saveStaff()}
          onCancel={() => setDraft(emptyStaffDraft)}
        />
        <div className="space-y-2">
          <h3 className="text-sm font-bold">Գրանցված անձնակազմ</h3>
          {guides.length + drivers.length === 0 ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">Զբոսավար կամ վարորդ դեռ չկա։</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {[...guides, ...drivers].map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-semibold">{member.fullName}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {member.role === "guide" ? "Զբոսավար" : "Վարորդ"}
                      {member.phone ? ` · ${member.phone}` : ""}
                    </span>
                  </span>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => handleEditStaff(member)}>
                    Խմբագրել
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-3xl border border-border bg-muted/40 p-4 sm:p-6">
        <div className="border-b border-border pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Տուրերի նշանակումներ</p>
          <h2 className="mt-1 text-xl font-black tracking-tight">2. Տուրերի զբոսավարներ և վարորդներ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Յուրաքանչյուր մեկնման համար ընտրեք զբոսավար և վարորդ գրանցված կարգավիճակներից։
          </p>
        </div>
        {tours.length === 0 ? (
          <p className="rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground">Ֆիզիկական տուրեր դեռ չկան։</p>
        ) : (
          <div className="space-y-3">
            {tours.map((tour) => (
              <article key={tour.id} className="space-y-3 rounded-3xl border border-border bg-card p-4">
                <h3 className="text-sm font-bold leading-snug">{tourTitle(tour)}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Զբոսավար" id={`guide-${tour.id}`}>
                    <Select
                      value={tour.guideId && guides.some((member) => member.id === tour.guideId) ? tour.guideId : "unassigned"}
                      onValueChange={(value) => void change(tour.id, value === "unassigned" ? null : value, tour.driverId)}
                    >
                      <SelectTrigger id={`guide-${tour.id}`} className="rounded-2xl">
                        <SelectValue placeholder="Ընտրել" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Չնշանակված</SelectItem>
                        {guides.map((member) => (
                          <SelectItem key={member.id} value={member.id}>{member.fullName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Վարորդ" id={`driver-${tour.id}`}>
                    <Select
                      value={tour.driverId && drivers.some((member) => member.id === tour.driverId) ? tour.driverId : "unassigned"}
                      onValueChange={(value) => void change(tour.id, tour.guideId, value === "unassigned" ? null : value)}
                    >
                      <SelectTrigger id={`driver-${tour.id}`} className="rounded-2xl">
                        <SelectValue placeholder="Ընտրել" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Չնշանակված</SelectItem>
                        {drivers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>{member.fullName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatProfileDate(value: string | undefined) {
  if (!value) return "—";
  const parsed = parseISO(value.length > 10 ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return format(parsed, "d MMMM yyyy", { locale: hy });
}

function bookingStatusText(booking: BookingRecord) {
  if (booking.paymentStatus === "FAILED") return "Չհաջողված";
  if (booking.paymentStatus === "PENDING") return "Սպասում";
  if (booking.status === "checked_in") return "Գրանցված";
  if (booking.paymentStatus === "SUCCESS") return "Վճարված";
  return "Հաստատված";
}

function TouristsSection({
  users,
  tours,
  portalTours,
  bookings,
}: {
  users: DirectoryUser[];
  tours: ManagedTour[];
  portalTours: AssignedTour[];
  bookings: BookingRecord[];
}) {
  const wallet = useSyncExternalStore(subscribeLoyalty, getLoyaltySnapshot, getLoyaltyServerSnapshot);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const [savingPoints, setSavingPoints] = useState<"add" | "sub" | "">("");
  const tourists = users.filter((user) => user.role === "tourist");
  const selected = tourists.find((user) => user.id === selectedId) ?? null;
  const query = search.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, "");
  const visible = tourists.filter((tourist) => {
    if (!query) return true;
    const text = `${tourist.fullName} ${tourist.email}`.toLowerCase();
    if (text.includes(query)) return true;
    return queryDigits.length > 0 && phoneKey(tourist.phone).includes(queryDigits);
  });

  useEffect(() => {
    hydrateLoyalty();
  }, []);

  useEffect(() => {
    if (!selected || !isSupabaseConfigured) return;
    void loadLoyalty(selected.phone).catch(() => undefined);
  }, [selected]);

  const pointsOf = (phone: string) => wallet.accounts[phoneKey(phone)]?.points ?? 0;
  const bookingsOf = (phone: string) => {
    const key = phoneKey(phone);
    if (key.length < 8) return [];
    return bookings.filter((booking) => phoneKey(booking.phone) === key);
  };
  const nameOf = (id: string | null) => {
    if (!id) return "Դեռ նշանակված չէ";
    return users.find((user) => user.id === id)?.fullName ?? "Դեռ նշանակված չէ";
  };

  const applyPoints = async (sign: 1 | -1) => {
    if (!selected) return;
    const amount = Math.round(Number(delta));
    if (!Number.isFinite(amount) || amount < 1) {
      toast.error("Գրեք դրական միավոր։");
      return;
    }
    setSavingPoints(sign > 0 ? "add" : "sub");
    try {
      await adjustLoyaltyPoints({ phone: selected.phone, fullName: selected.fullName, delta: sign * amount });
      setDelta("");
      toast.success(sign > 0 ? "Միավորները ավելացան" : "Միավորները նվազեցին");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Միավորները չփոխվեցին։");
    } finally {
      setSavingPoints("");
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Զբոսաշրջիկներ</h1>
        <p className="mt-1 text-sm text-muted-foreground">Գրանցված զբոսաշրջիկներ, միավորներ և ամրագրումներ</p>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Որոնել անունով, հեռախոսով կամ էլ. փոստով"
        aria-label="Որոնել զբոսաշրջիկ"
        className="h-11 rounded-2xl"
      />
      <div className="overflow-x-auto rounded-3xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Անուն Ազգանուն</TableHead>
              <TableHead>Հեռախոս</TableHead>
              <TableHead>Էլ. փոստ</TableHead>
              <TableHead>Ծննդյան ամսաթիվ</TableHead>
              <TableHead>Կուտակած միավորներ</TableHead>
              <TableHead>Ամրագրումների քանակ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {tourists.length === 0 ? "Գրանցված զբոսաշրջիկ չկա։" : "Այս որոնմամբ զբոսաշրջիկ չկա։"}
                </TableCell>
              </TableRow>
            )}
            {visible.map((tourist) => (
              <TableRow key={tourist.id} className="cursor-pointer" onClick={() => setSelectedId(tourist.id)}>
                <TableCell className="font-medium">{tourist.fullName}</TableCell>
                <TableCell>{tourist.phone || "—"}</TableCell>
                <TableCell>{tourist.email || "—"}</TableCell>
                <TableCell>{formatProfileDate(tourist.birthDate)}</TableCell>
                <TableCell>{pointsOf(tourist.phone)}</TableCell>
                <TableCell>{bookingsOf(tourist.phone).length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setDelta("");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.fullName}</DialogTitle>
                <DialogDescription>Զբոսաշրջիկի տվյալներ, միավորներ և ամրագրված տուրեր</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <section className="space-y-2 rounded-2xl border border-border p-4">
                  <h2 className="text-sm font-black">Անձնական տվյալներ</h2>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Անուն Ազգանուն</dt>
                      <dd className="font-semibold">{selected.fullName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Հեռախոս</dt>
                      <dd className="font-semibold">{selected.phone || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Էլ. փոստ</dt>
                      <dd className="font-semibold">{selected.email || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Ծննդյան ամսաթիվ</dt>
                      <dd className="font-semibold">{formatProfileDate(selected.birthDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Գրանցման ամսաթիվ</dt>
                      <dd className="font-semibold">{formatProfileDate(selected.createdAt)}</dd>
                    </div>
                  </dl>
                </section>

                <section className="space-y-3 rounded-2xl border border-border p-4">
                  <h2 className="text-sm font-black">Միավորների կառավարում</h2>
                  <p className="text-sm">
                    Ընթացիկ մնացորդ՝ <span className="font-black">{pointsOf(selected.phone)}</span>
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      inputMode="numeric"
                      value={delta}
                      onChange={(event) => setDelta(event.target.value.replace(/[^\d]/g, ""))}
                      placeholder="Միավոր"
                      aria-label="Միավորների քանակ"
                      className="h-11 rounded-2xl sm:max-w-40"
                    />
                    <Button
                      type="button"
                      className="rounded-full font-bold"
                      disabled={savingPoints !== ""}
                      onClick={() => void applyPoints(1)}
                    >
                      {savingPoints === "add" ? "Պահվում է" : "Ավելացնել"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full font-bold"
                      disabled={savingPoints !== ""}
                      onClick={() => void applyPoints(-1)}
                    >
                      {savingPoints === "sub" ? "Պահվում է" : "Հանել"}
                    </Button>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-sm font-black">Գրանցված տուրեր</h2>
                  {bookingsOf(selected.phone).length === 0 && (
                    <p className="text-sm text-muted-foreground">Այս զբոսաշրջիկը դեռ տուր չի ամրագրել։</p>
                  )}
                  {bookingsOf(selected.phone).map((booking) => {
                    const tour = tours.find((item) => item.id === booking.tourId && item.is_virtual_only !== true);
                    const portalTour = portalTours.find((item) => item.id === booking.tourId);
                    const departureDate = portalTour?.departureDate ?? (tour ? upcomingDepartureDate(tour.day) : "");
                    const departureTime = tour?.departureTime || portalTour?.departureTime || "—";
                    const seats = booking.adults + booking.children;
                    return (
                      <article key={booking.id} className="space-y-1 rounded-2xl border border-border p-4 text-sm">
                        <p className="font-bold">{tour ? tourTitle(tour) : portalTour?.title ?? booking.tourId}</p>
                        <p className="text-muted-foreground">
                          {formatProfileDate(departureDate)} · մեկնում {departureTime}
                        </p>
                        <p>
                          {seats} տեղ · {bookingStatusText(booking)}
                        </p>
                        <p className="text-xs text-muted-foreground">Զբոսավար՝ {nameOf(tour?.guideId ?? portalTour?.guideId ?? null)}</p>
                        <p className="text-xs text-muted-foreground">Վարորդ՝ {nameOf(tour?.driverId ?? portalTour?.driverId ?? null)}</p>
                      </article>
                    );
                  })}
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function staffName(users: DirectoryUser[], id: string | null, role: "guide" | "driver") {
  if (!id) return "Նշանակված չէ";
  return users.find((user) => user.id === id && user.role === role)?.fullName ?? "Նշանակված չէ";
}

function departureLabel(tour: ManagedTour) {
  const date = upcomingDepartureDate(tour.day);
  const parsed = parseISO(date);
  const pretty = Number.isNaN(parsed.getTime()) ? date : format(parsed, "d MMMM yyyy", { locale: hy });
  return `${pretty}, ${tour.departureTime}`;
}

function emailForPhone(users: DirectoryUser[], phone: string) {
  const key = phoneKey(phone);
  if (key.length < 8) return "";
  return users.find((user) => user.email && phoneKey(user.phone) === key)?.email ?? "";
}

function BookingsSection({
  tours,
  users,
  bookings,
  revenue,
  error,
}: {
  tours: ManagedTour[];
  users: DirectoryUser[];
  bookings: {
    id: string;
    tourId: string;
    passengerName: string;
    phone: string;
    ticketCode: string;
    paymentProvider: keyof typeof paymentLabel | null;
    paymentStatus: keyof typeof paymentStatusLabel | null;
    status: "booked" | "checked_in";
    amount: number;
    adults: number;
    children: number;
  }[];
  revenue: number;
  error: string;
}) {
  const paid = bookings.filter((booking) => booking.paymentStatus === "SUCCESS").length;
  const pending = bookings.filter((booking) => booking.paymentStatus === "PENDING").length;
  const checkedIn = bookings.filter((booking) => booking.status === "checked_in").length;
  const titleOf = (tourId: string) => {
    const tour = tours.find((item) => item.id === tourId);
    return tour ? tourTitle(tour) : tourId;
  };
  const physical = tours.filter((tour) => tour.is_virtual_only !== true);
  const known = new Set(physical.map((tour) => tour.id));
  const departures = [
    ...physical.map((tour) => ({
      key: tour.id,
      title: tourTitle(tour),
      departure: departureLabel(tour),
      guideName: staffName(users, tour.guideId, "guide"),
      driverName: staffName(users, tour.driverId, "driver"),
      fileName: `Ուղևորներ-${tour.id}-${upcomingDepartureDate(tour.day)}.xlsx`,
      rows: bookings.filter((booking) => booking.tourId === tour.id),
    })),
    ...[...new Set(bookings.map((booking) => booking.tourId))]
      .filter((tourId) => !known.has(tourId))
      .map((tourId) => ({
        key: tourId,
        title: titleOf(tourId),
        departure: "—",
        guideName: "Նշանակված չէ",
        driverName: "Նշանակված չէ",
        fileName: `Ուղևորներ-${tourId}.xlsx`,
        rows: bookings.filter((booking) => booking.tourId === tourId),
      })),
  ];

  const exportDeparture = (departure: (typeof departures)[number]) => {
    const passengers = departure.rows
      .slice()
      .sort((a, b) => a.passengerName.localeCompare(b.passengerName, "hy"))
      .map((booking) => ({
        fullName: booking.passengerName,
        phone: booking.phone,
        email: emailForPhone(users, booking.phone),
        seats: booking.adults + booking.children,
        paymentStatus: booking.paymentStatus ? paymentStatusLabel[booking.paymentStatus] : "—",
        notes: "",
      }));
    try {
      downloadPassengerWorkbook({
        tourTitle: departure.title,
        departure: departure.departure,
        guideName: departure.guideName,
        driverName: departure.driverName,
        fileName: departure.fileName,
        passengers,
      });
      toast.success("Excel ֆայլը ներբեռնվեց");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel ֆայլը չստեղծվեց։");
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Ամրագրումներ</h1>
        <p className="mt-1 text-sm text-muted-foreground">Idram, Telcell և ArCa վճարումներ, գրանցում և եկամուտ</p>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Եկամուտ" value={formatAmd(revenue)} />
        <Stat label="Վճարված" value={String(paid)} />
        <Stat label="Սպասման մեջ" value={String(pending)} />
        <Stat label="Գրանցված ուղևոր" value={String(checkedIn)} />
      </div>
      <div className="space-y-3">
        {departures.map((departure) => {
          const seats = departure.rows.reduce((sum, booking) => sum + booking.adults + booking.children, 0);
          return (
            <article key={departure.key} className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-base font-black leading-snug">{departure.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{departure.departure}</p>
                <p className="mt-1 text-sm">Զբոսավար՝ {departure.guideName}</p>
                <p className="text-sm">Վարորդ՝ {departure.driverName}</p>
                <p className="mt-1 text-sm font-semibold">Ամրագրված ուղևորներ՝ {seats}</p>
              </div>
              <Button type="button" variant="outline" className="rounded-full font-bold" onClick={() => exportDeparture(departure)}>
                <FileSpreadsheet className="h-4 w-4" />
                Արտահանել Excel
              </Button>
            </article>
          );
        })}
      </div>
      <div className="rounded-3xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ուղևոր</TableHead>
              <TableHead>Տուր</TableHead>
              <TableHead>Տոմս</TableHead>
              <TableHead>Վճարում</TableHead>
              <TableHead>Կարգավիճակ</TableHead>
              <TableHead>Գրանցում</TableHead>
              <TableHead className="text-right">Գումար</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">Ամրագրումներ դեռ չկան։</TableCell>
              </TableRow>
            )}
            {bookings.map((booking) => (
              <TableRow key={booking.id}>
                <TableCell className="font-medium">
                  {booking.passengerName}
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {booking.adults} մեծ · {booking.children} երեխա
                  </span>
                </TableCell>
                <TableCell className="max-w-[220px] whitespace-normal">{titleOf(booking.tourId)}</TableCell>
                <TableCell>{booking.ticketCode}</TableCell>
                <TableCell>{booking.paymentProvider ? paymentLabel[booking.paymentProvider] : "—"}</TableCell>
                <TableCell>{booking.paymentStatus ? paymentStatusLabel[booking.paymentStatus] : "—"}</TableCell>
                <TableCell>{booking.status === "checked_in" ? "Գրանցված է" : "Սպասում է"}</TableCell>
                <TableCell className="text-right font-semibold">{formatAmd(booking.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function SettingsSection({ settings }: { settings: SiteSettings }) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const save = async () => {
    if (!draft.bannerTitle.trim() || !draft.bannerText.trim() || !draft.departurePlace.trim()) {
      toast.error("Լրացրեք բոլոր դաշտերը։");
      return;
    }
    setSaving(true);
    try {
      await saveSettings(draft);
      toast.success("Կարգավորումները պահվեցին");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Չպահպանվեց։");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Կարգավորումներ</h1>
        <p className="mt-1 text-sm text-muted-foreground">Գլխավոր էջի տեքստ, մեկնման վայր և հետվճար</p>
      </div>
      <form
        className="space-y-4 rounded-3xl border border-border bg-card p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Վերնագրի տեքստ" id="banner-title">
          <Textarea
            id="banner-title"
            value={draft.bannerTitle}
            onChange={(event) => setDraft({ ...draft, bannerTitle: event.target.value })}
            className="min-h-24 rounded-2xl"
          />
        </Field>
        <Field label="Ենթավերնագիր" id="banner-text">
          <Textarea
            id="banner-text"
            value={draft.bannerText}
            onChange={(event) => setDraft({ ...draft, bannerText: event.target.value })}
            className="min-h-24 rounded-2xl"
          />
        </Field>
        <Field label="Մեկնման վայր Արմավիրից" id="departure-place">
          <Input
            id="departure-place"
            value={draft.departurePlace}
            onChange={(event) => setDraft({ ...draft, departurePlace: event.target.value })}
            className="rounded-2xl"
          />
        </Field>
        <Field label="Հետվճարի տոկոս" id="cashback">
          <Input
            id="cashback"
            inputMode="numeric"
            value={String(draft.cashbackPercent)}
            onChange={(event) => {
              const value = Number(event.target.value);
              setDraft({ ...draft, cashbackPercent: Number.isFinite(value) ? value : 0 });
            }}
            className="rounded-2xl"
          />
        </Field>
        <Button type="submit" className="rounded-full font-bold" disabled={saving}>
          {saving ? "Պահվում է" : "Պահպանել"}
        </Button>
      </form>
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}
