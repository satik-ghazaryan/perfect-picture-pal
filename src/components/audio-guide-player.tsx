import { useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Languages, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AudioChapter } from "@/data/tours";

const speeds = [1, 1.25, 1.5] as const;

const languages = [
  { code: "hy", label: "Հայերեն" },
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
];

function LanguageSelect({ lang, onChange }: { lang: string; onChange: (value: string) => void }) {
  return (
    <Select value={lang} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[140px] rounded-full bg-card text-xs font-semibold">
        <Languages className="h-3.5 w-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {languages.map((item) => (
          <SelectItem key={item.code} value={item.code}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const emptyChapters: AudioChapter[] = [];

export function AudioGuidePlayer({ chapters = emptyChapters }: { chapters?: AudioChapter[] }) {
  const source = chapters ?? emptyChapters;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [lang, setLang] = useState("hy");
  const [mediaDuration, setMediaDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const list = useMemo(
    () => source.filter((chapter) => (chapter.language ?? "hy") === lang),
    [source, lang],
  );

  const safeIndex = list.length === 0 ? 0 : Math.min(index, list.length - 1);
  const current = list[safeIndex];
  const total = useMemo(() => list.reduce((sum, chapter) => sum + chapter.duration, 0), [list]);
  const duration = mediaDuration > 0 ? mediaDuration : current?.duration ?? 0;

  useEffect(() => {
    setIndex(0);
    setPosition(0);
    setPlaying(false);
    setMediaDuration(0);
  }, [lang]);

  useEffect(() => {
    setMediaDuration(0);
    setPosition(0);
  }, [current?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current?.audioUrl) return;
    audio.playbackRate = speed;
    if (!playing) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => setPlaying(false));
  }, [playing, speed, current?.id, current?.audioUrl]);

  useEffect(() => {
    if (!playing || !current || current.audioUrl) return;
    const chapterDuration = current.duration;
    const chapterIndex = safeIndex;
    const count = list.length;
    const id = window.setInterval(() => {
      setPosition((p) => {
        const next = p + speed;
        if (next >= chapterDuration) {
          if (chapterIndex < count - 1) {
            setIndex(chapterIndex + 1);
            return 0;
          }
          setPlaying(false);
          return chapterDuration;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing, speed, current, safeIndex, list.length]);

  const select = (i: number) => {
    setIndex(i);
    setPosition(0);
    setPlaying(true);
  };

  const finishChapter = () => {
    if (safeIndex < list.length - 1) {
      setIndex(safeIndex + 1);
      setPosition(0);
      return;
    }
    setPlaying(false);
    setPosition(duration);
  };

  if (!current) {
    return (
      <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
        {source.length > 0 && (
          <div className="mb-3 flex justify-end">
            <LanguageSelect lang={lang} onChange={setLang} />
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {source.length > 0 ? "Այս լեզվով գլուխներ դեռ չկան։" : "Աուդիոգիդը այս տուրի համար դեռ հասանելի չէ։"}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Headphones className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">Աուդիոգիդ</p>
            <p className="text-[11px] text-muted-foreground">
              {list.length} գլուխ · {fmt(total)} ընդհանուր
            </p>
          </div>
        </div>
        <LanguageSelect lang={lang} onChange={setLang} />
      </div>

      <div className="space-y-3 p-4">
        {current.audioUrl && (
          <audio
            key={current.id}
            ref={audioRef}
            src={current.audioUrl}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const next = event.currentTarget.duration;
              if (Number.isFinite(next) && next > 0) setMediaDuration(next);
            }}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onEnded={finishChapter}
          />
        )}
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            Գլուխ {safeIndex + 1} / {list.length}
          </p>
          <p className="text-base font-bold leading-snug">{current.title}</p>
        </div>

        <Slider
          value={[Math.min(position, duration || 1)]}
          max={duration || 1}
          step={1}
          onValueChange={(v) => {
            const next = v[0];
            if (next === undefined) return;
            setPosition(next);
            if (audioRef.current && current.audioUrl) audioRef.current.currentTime = next;
          }}
          aria-label="Նվագարկման ժամանակագիծ"
        />
        <div className="flex justify-between text-[11px] font-medium text-muted-foreground">
          <span>{fmt(position)}</span>
          <span>{fmt(duration)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              className="rounded-full"
              onClick={() => select(Math.max(0, index - 1))}
              aria-label="Նախորդ գլուխ"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              className="h-12 w-12 rounded-full"
              onClick={() => setPlaying((v) => !v)}
              aria-label={playing ? "Դադար" : "Նվագարկել"}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="rounded-full"
              onClick={() => select(Math.min(list.length - 1, index + 1))}
              aria-label="Հաջորդ գլուխ"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center rounded-full bg-muted p-1">
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold transition-colors",
                  speed === s
                    ? "bg-card text-primary shadow-card"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-border rounded-2xl border border-border">
          {list.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => select(i)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-primary-soft",
                  i === safeIndex && "bg-primary-soft",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                    i === safeIndex
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {fmt(c.duration)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
