import { PanoramaViewer } from "@/components/panorama-viewer";
import type { Tour } from "@/data/tours";
import { tourTitle, useSiteLocale } from "@/lib/locale";

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function isImageUrl(value: string) {
  return /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(value) || value.startsWith("data:image");
}

function panoramaSource(tour: Tour) {
  const url = tour.panoramaUrl?.trim() ?? "";
  if (!url) return tour.image_url;
  if (isImageUrl(url) || url.startsWith("/")) return url;
  return tour.image_url;
}

export function TourPanorama({ tour }: { tour: Tour }) {
  const title = tourTitle(tour, useSiteLocale());
  const embed = safeHttpUrl(tour.virtual_tour_url ?? "");
  if (embed && !isImageUrl(embed)) {
    return (
      <iframe
        title={`${title} · 360°`}
        src={embed}
        className="h-[260px] w-full rounded-3xl border border-border bg-navy sm:h-[420px]"
        allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"
        allowFullScreen
      />
    );
  }
  const image = embed && isImageUrl(embed) ? embed : panoramaSource(tour);
  return <PanoramaViewer image={image} title={title} hotspots={tour.hotspots} />;
}
