import type { AudioChapter } from "@/data/tours";

export const garniGuideAudioUrl = "/audio/garni-guide.m4a";
export const garniGuideDurationSeconds = 16 * 60 + 30;

export const garniGuideChapter: AudioChapter = {
  id: "garni-guide",
  title: "Գառնի, Գեղարդ և Քարերի սիմֆոնիա",
  duration: garniGuideDurationSeconds,
  language: "hy",
  audioUrl: garniGuideAudioUrl,
};

export function withPublishedGarniAudio<T extends { id: string }>(tour: T): T {
  if (tour.id !== "garni") return tour;
  return {
    ...tour,
    hasAudioGuide: true,
    audioChapters: [garniGuideChapter],
  };
}
