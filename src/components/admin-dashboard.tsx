import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronDown, ChevronUp, LogOut, Plus, Settings, Ticket, Trash2, Users } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmd, regions, tourTypes, type AudioChapter, type AudioLanguage, type Tour } from "@/data/tours";
import {
  assignStaff,
  deleteTour,
  getAdminServerSnapshot,
  getAdminSnapshot,
  loadAdminBookings,
  loadStaff,
  localStaff,
  saveSettings,
  saveTour,
  signOutAdmin,
  subscribeAdmin,
  type AdminSession,
  type ManagedTour,
  type SiteSettings,
  type StaffMember,
} from "@/lib/admin";
import { getPortalServerSnapshot, getPortalSnapshot, subscribePortal } from "@/lib/guide-api";
import { isSupabaseConfigured } from "@/lib/supabase";

const sections = [
  { id: "tours", label: "Տուրեր", icon: CalendarDays },
  { id: "staff", label: "Զբոսավարներ և Վարորդներ", icon: Users },
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

type Draft = {
  id: string | null;
  title: string;
  price: string;
  seats: string;
  departureTime: string;
  returnTime: string;
  day: Tour["day"];
  region: string;
  type: Tour["type"];
  summary: string;
  image: string;
  panoramaUrl: string;
  itinerary: string;
  chapters: ChapterDraft[];
};

const chapterLanguages: { value: AudioLanguage; label: string }[] = [
  { value: "hy", label: "HY · Հայերեն" },
  { value: "en", label: "EN · English" },
  { value: "ru", label: "RU · Русский" },
];

function emptyDraft(): Draft {
  return {
    id: null,
    title: "",
    price: "",
    seats: "12",
    departureTime: "08:30",
    returnTime: "19:00",
    day: "saturday",
    region: regions[0] ?? "Գառնի և Գեղարդ",
    type: "Մշակութային",
    summary: "",
    image: "",
    panoramaUrl: "",
    itinerary: "",
    chapters: [],
  };
}

function draftFromTour(tour: ManagedTour): Draft {
  return {
    id: tour.id,
    title: tour.title,
    price: String(tour.price),
    seats: String(tour.seatsLeft),
    departureTime: tour.departureTime,
    returnTime: tour.returnTime,
    day: tour.day,
    region: tour.region,
    type: tour.type,
    summary: tour.summary,
    image: tour.image,
    panoramaUrl: tour.panoramaUrl,
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
  const [staff, setStaff] = useState<StaffMember[]>(isSupabaseConfigured ? [] : localStaff);
  const [staffError, setStaffError] = useState("");
  const [remoteBookings, setRemoteBookings] = useState(portal.bookings);
  const [bookingError, setBookingError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) return;
    loadStaff()
      .then((rows) => {
        if (!cancelled) setStaff(rows);
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
        {section === "tours" && <ToursSection tours={catalog.tours} />}
        {section === "staff" && (
          <StaffSection tours={catalog.tours} staff={staff} error={staffError} />
        )}
        {section === "bookings" && (
          <BookingsSection
            tours={catalog.tours}
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

function ToursSection({ tours }: { tours: ManagedTour[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    const price = Math.round(Number(draft.price));
    const seats = Math.round(Number(draft.seats));
    if (title.length < 2) {
      toast.error("Գրեք տուրի անունը։");
      return;
    }
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(seats) || seats <= 0) {
      toast.error("Գինը և տեղերը պետք է դրական թիվ լինեն։");
      return;
    }
    const existing = draft.id ? tours.find((tour) => tour.id === draft.id) : undefined;
    const id = draft.id ?? nextId(title, tours);
    const audio = chaptersToSave(draft.chapters, id);
    if (!audio) {
      toast.error("Լրացրեք գլխի վերնագիրը, իսկ տևողությունը գրեք MM:SS ձևաչափով։");
      return;
    }
    const panoramaUrl = draft.panoramaUrl.trim();
    const image = draft.image.trim() || existing?.image || tours[0]?.image || "";
    if (!image) {
      toast.error("Ավելացրեք նկարի հղում։");
      return;
    }
    const next: ManagedTour = {
      id,
      title,
      image,
      region: draft.region,
      type: draft.type,
      departurePlace: getAdminSnapshot().settings.departurePlace,
      departureTime: draft.departureTime || "08:30",
      returnTime: draft.returnTime || "19:00",
      price,
      seatsLeft: seats,
      rating: existing?.rating ?? 5,
      reviews: existing?.reviews ?? 0,
      has360: panoramaUrl.length > 0 || existing?.has360 === true,
      hasAudioGuide: audio.length > 0,
      day: draft.day,
      summary: draft.summary.trim(),
      highlights: existing?.highlights ?? [],
      itinerary: parseItinerary(draft.itinerary),
      included: existing?.included ?? ["Հարմարավետ ավտոբուս Արմավիրից և վերադարձ", "Հայախոս ուղեկցորդ"],
      excluded: existing?.excluded ?? ["Ճաշ և անձնական ծախսեր"],
      audioChapters: audio,
      hotspots: existing?.hotspots ?? [],
      panoramaUrl,
      guideId: existing?.guideId ?? null,
      driverId: existing?.driverId ?? null,
    };
    if (existing?.oldPrice !== undefined) next.oldPrice = existing.oldPrice;
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
          <h1 className="text-2xl font-black tracking-tight">Տուրեր</h1>
          <p className="mt-1 text-sm text-muted-foreground">Արմավիրից մեկնող մեկօրյա տուրեր</p>
        </div>
        <Button type="button" className="rounded-full font-bold" onClick={() => setDraft(emptyDraft())}>
          <Plus className="h-4 w-4" />
          Նոր տուր
        </Button>
      </div>

      <div className="space-y-3">
        {tours.map((tour) => (
          <article key={tour.id} className="rounded-3xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-snug">{tour.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatAmd(tour.price)} · {tour.seatsLeft} տեղ · {tour.departureTime}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-full" asChild>
                  <Link to="/tours/$id" params={{ id: tour.id }}>Դիտել</Link>
                </Button>
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setDraft(draftFromTour(tour))}>
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
        ))}
      </div>

      {draft && (
        <form
          className="space-y-4 rounded-3xl border border-border bg-card p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 className="text-lg font-black">{draft.id ? "Խմբագրել տուրը" : "Նոր տուր"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Անուն" id="tour-title">
              <Input id="tour-title" value={draft.title} onChange={(event) => update({ title: event.target.value })} className="rounded-2xl" />
            </Field>
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
            <Field label="Շրջան" id="tour-region">
              <Select value={draft.region} onValueChange={(region) => update({ region })}>
                <SelectTrigger id="tour-region" className="rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((region) => (
                    <SelectItem key={region} value={region}>{region}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
          <Field label="Համառոտ" id="tour-summary">
            <Textarea id="tour-summary" value={draft.summary} onChange={(event) => update({ summary: event.target.value })} className="min-h-20 rounded-2xl" />
          </Field>
          <Field label="Նկարի հղում" id="tour-image">
            <Input id="tour-image" value={draft.image} onChange={(event) => update({ image: event.target.value })} placeholder="https://..." className="rounded-2xl" />
          </Field>
          <Field label="360° պանորամայի հղում" id="tour-panorama">
            <Input id="tour-panorama" value={draft.panoramaUrl} onChange={(event) => update({ panoramaUrl: event.target.value })} placeholder="Նկարի հղում՝ jpg կամ png" className="rounded-2xl" />
          </Field>
          <Field label="Ծրագիր (ժամ | վերնագիր | նկարագրություն)" id="tour-itinerary">
            <Textarea id="tour-itinerary" value={draft.itinerary} onChange={(event) => update({ itinerary: event.target.value })} className="min-h-32 rounded-2xl" placeholder={"08:30 | Մեկնում Արմավիրից | Հավաք Կենտրոնական հրապարակում"} />
          </Field>
          <AudioChapterManager
            chapters={draft.chapters}
            onChange={(chapters) => update({ chapters })}
          />
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

function StaffSection({
  tours,
  staff,
  error,
}: {
  tours: ManagedTour[];
  staff: StaffMember[];
  error: string;
}) {
  const guides = staff.filter((member) => member.role === "guide");
  const drivers = staff.filter((member) => member.role === "driver");

  const change = async (tourId: string, guideId: string | null, driverId: string | null) => {
    try {
      await assignStaff(tourId, guideId, driverId);
      toast.success("Նշանակումը պահվեց");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Նշանակումը չպահվեց։");
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Զբոսավարներ և Վարորդներ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ընտրեք ուղեկցորդ և վարորդ յուրաքանչյուր մեկնման համար։
        </p>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      {staff.length === 0 && !error && (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">Գրանցված անձնակազմ դեռ չկա։</p>
      )}
      {tours.map((tour) => (
        <article key={tour.id} className="space-y-3 rounded-3xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold leading-snug">{tour.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ուղեկցորդ" id={`guide-${tour.id}`}>
              <Select
                value={tour.guideId ?? "unassigned"}
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
                value={tour.driverId ?? "unassigned"}
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
    </section>
  );
}

function BookingsSection({
  tours,
  bookings,
  revenue,
  error,
}: {
  tours: ManagedTour[];
  bookings: {
    id: string;
    tourId: string;
    passengerName: string;
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
  const titleOf = (tourId: string) => tours.find((tour) => tour.id === tourId)?.title ?? tourId;

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
