import { useEffect, useMemo, useState } from "react";
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

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function AudioGuidePlayer({ chapters }: { chapters: AudioChapter[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [lang, setLang] = useState("hy");

  const current = chapters[index];
  const total = useMemo(() => chapters.reduce((a, c) => a + c.duration, 0), [chapters]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setPosition((p) => {
        const next = p + speed;
        if (next >= current.duration) {
          if (index < chapters.length - 1) {
            setIndex(index + 1);
            return 0;
          }
          setPlaying(false);
          return current.duration;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing, speed, current, index, chapters.length]);

  const select = (i: number) => {
    setIndex(i);
    setPosition(0);
    setPlaying(true);
  };

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
              {chapters.length} գլուխ · {fmt(total)} ընդհանուր
            </p>
          </div>
        </div>
        <Select value={lang} onValueChange={setLang}>
          <SelectTrigger className="h-9 w-[140px] rounded-full bg-card text-xs font-semibold">
            <Languages className="h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languages.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            Գլուխ {index + 1} / {chapters.length}
          </p>
          <p className="text-base font-bold leading-snug">{current.title}</p>
        </div>

        <Slider
          value={[Math.min(position, current.duration)]}
          max={current.duration}
          step={1}
          onValueChange={(v) => setPosition(v[0])}
          aria-label="Նվագարկման ժամանակագիծ"
        />
        <div className="flex justify-between text-[11px] font-medium text-muted-foreground">
          <span>{fmt(position)}</span>
          <span>{fmt(current.duration)}</span>
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
              onClick={() => select(Math.min(chapters.length - 1, index + 1))}
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
          {chapters.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => select(i)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-primary-soft",
                  i === index && "bg-primary-soft",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                    i === index
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
