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
      <div>
        <iframe
          title={tour.title_hy || title}
          src={embed}
          loading="lazy"
          allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"
          allowFullScreen
          className="block rounded-3xl bg-navy"
          style={{ width: "100%", height: "clamp(320px, 65vh, 600px)", border: 0 }}
        />
        <a
          href={embed}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex text-sm font-bold text-primary underline underline-offset-4"
        >
          Բացել 360° տուրը նոր պատուհանում
        </a>
      </div>
    );
  }
  const image = embed && isImageUrl(embed) ? embed : panoramaSource(tour);
  return <PanoramaViewer image={image} title={title} hotspots={tour.hotspots} />;
}
