import type { Tour } from "@/data/tours";

export const CHAT_TEST_TOUR_ID = "chat-test";
export const CHAT_TEST_TITLE = "Թեստային տուր";
export const CHAT_TEST_OPEN_ID = "chat-test-open";
export const CHAT_TEST_OPEN_DATE = "2026-12-20";
export const CHAT_TEST_OPEN_TIME = "08:30";
export const CHAT_TEST_OPEN_SEATS = 4;
export const CHAT_TEST_PRICE = 12000;
export const CHAT_TEST_PLACE = "Արմավիր քաղաք, Կենտրոնական հրապարակ";

export function chatTestTour(): Tour {
  return {
    id: CHAT_TEST_TOUR_ID,
    title_hy: CHAT_TEST_TITLE,
    title_en: "Test tour",
    title_ru: "Тестовый тур",
    description_hy: "Սա միայն մեկուսացված փորձարկման տուր է։ Արտադրական ամրագրում չի ստեղծվում։",
    description_en: "Isolated test tour. No production booking is created.",
    description_ru: "Изолированный тестовый тур. Производственная бронь не создаётся.",
    location_hy: "Փորձարկում",
    location_en: "Test",
    location_ru: "Тест",
    image_url: "/logo.png",
    category: "Փորձարկում",
    type: "Մշակութային",
    departurePlace: CHAT_TEST_PLACE,
    departureTime: CHAT_TEST_OPEN_TIME,
    returnTime: "19:30",
    price: CHAT_TEST_PRICE,
    seatsLeft: CHAT_TEST_OPEN_SEATS,
    rating: 5,
    reviews: 0,
    has360: false,
    hasAudioGuide: false,
    day: "",
    highlights: ["Մեկուսացված տվյալ, արտադրական կատալոգում չկա"],
    itinerary: [
      {
        time: CHAT_TEST_OPEN_TIME,
        title: "Մեկնում",
        description: "Թեստային մեկնումը բաց է միայն այս փորձի համար։",
      },
    ],
    included: ["Մեկուսացված թեստային տոմս"],
    excluded: ["Արտադրական ամրագրում"],
    audioChapters: [],
    hotspots: [],
    is_virtual_only: false,
    virtual_tour_id: null,
  };
}
