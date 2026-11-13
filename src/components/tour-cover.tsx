import { useRef, type PointerEvent } from "react";
import {
  CENTER_COVER,
  coverObjectPosition,
  coverPositionAfterArrow,
  coverPositionAfterDrag,
  type CoverPosition,
} from "@/lib/cover-frame";
import { cn } from "@/lib/utils";

type Props = {
  src: string;
  alt: string;
  position?: CoverPosition | null | undefined;
  variant: "card" | "page";
  interactive?: boolean;
  onPosition?: (position: CoverPosition) => void;
  className?: string;
};

export function TourCover({
  src,
  alt,
  position,
  variant,
  interactive = false,
  onPosition,
  className,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; position: CoverPosition } | null>(null);
  const point = position ?? CENTER_COVER;

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current?.getBoundingClientRect();
    const image = imageRef.current;
    if (!drag || !frame || !image || !onPosition) return;
    onPosition(
      coverPositionAfterDrag(drag.position, event.clientX - drag.x, event.clientY - drag.y, frame, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      }),
    );
  };

  return (
    <div
      ref={frameRef}
      className={cn(
        "relative overflow-hidden bg-muted",
        variant === "card" ? "h-48 w-full sm:h-52" : "aspect-video w-full",
        interactive &&
          "cursor-grab touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:cursor-grabbing",
        className,
      )}
      tabIndex={interactive ? 0 : undefined}
      aria-keyshortcuts={interactive ? "ArrowUp ArrowDown ArrowLeft ArrowRight" : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              const next = coverPositionAfterArrow(point, event.key);
              if (!next || !onPosition) return;
              event.preventDefault();
              onPosition(next);
            }
          : undefined
      }
      onPointerDown={
        interactive
          ? (event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { x: event.clientX, y: event.clientY, position: point };
            }
          : undefined
      }
      onPointerMove={interactive ? move : undefined}
      onPointerUp={
        interactive
          ? () => {
              dragRef.current = null;
            }
          : undefined
      }
      onPointerCancel={
        interactive
          ? () => {
              dragRef.current = null;
            }
          : undefined
      }
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={false}
        className="h-full w-full object-cover select-none"
        style={{ objectPosition: coverObjectPosition(point) }}
      />
    </div>
  );
}
