import { Clock, Headphones, MapPin, Rotate3d, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAmd, type Tour } from "@/data/tours";

export function TourCard({ tour }: { tour: Tour }) {
  const low = tour.seatsLeft <= 5;

  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-float">
      <div className="relative">
        <img
          src={tour.image}
          alt={tour.title}
          loading="lazy"
          width={1024}
          height={768}
          className="h-48 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-52"
        />
        <div className="absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
          {tour.has360 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-navy/85 px-2.5 py-1 text-[11px] font-semibold text-navy-foreground backdrop-blur">
              <Rotate3d className="h-3.5 w-3.5" /> 360° դիտում
            </span>
          )}
          {tour.hasAudioGuide && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground backdrop-blur">
              <Headphones className="h-3.5 w-3.5" /> Աուդիոգիդ
            </span>
          )}
        </div>
        <span
          className={`absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            low
              ? "bg-destructive text-destructive-foreground"
              : "bg-card/90 text-foreground backdrop-blur"
          }`}
        >
          {low ? `Մնացել է ընդամենը ${tour.seatsLeft} տեղ` : `Առկա է ${tour.seatsLeft} տեղ`}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-base font-bold leading-snug">{tour.title}</h3>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-1 text-xs font-bold text-accent-foreground">
            <Star className="h-3.5 w-3.5 fill-accent text-accent" />
            {tour.rating}
          </span>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0" /> 1 օր · մեկնումը՝ {tour.departureTime}
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tour.departurePlace}</span>
          </p>
          <p>{tour.reviews} կարծիք · {tour.type}</p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 pt-1">
          <div className="min-w-0">
            {tour.oldPrice && (
              <span className="mr-1.5 text-xs font-medium text-muted-foreground line-through">
                {formatAmd(tour.oldPrice)}
              </span>
            )}
            <span className="text-lg font-extrabold text-primary">{formatAmd(tour.price)}</span>
            <span className="block text-[11px] text-muted-foreground">մեկ անձի համար</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="rounded-full font-semibold">
            Մանրամասներ
          </Button>
          <Button className="rounded-full font-semibold">Ամրագրել</Button>
        </div>
      </div>
    </article>
  );
}
