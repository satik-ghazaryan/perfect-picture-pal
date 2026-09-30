import tatev from "@/assets/tour-tatev.jpg";
import sevan from "@/assets/tour-sevan.jpg";
import garni from "@/assets/tour-garni.jpg";

export type ItineraryStop = {
  time: string;
  title: string;
  description: string;
};

export type AudioChapter = {
  id: string;
  title: string;
  duration: number; // seconds
};

export type Hotspot = {
  id: string;
  x: number; // percent of panorama width
  y: number; // percent of viewer height
  title: string;
  description: string;
};

export type Tour = {
  id: string;
  title: string;
  image: string;
  region: string;
  type: "Արշավային" | "Մշակութային" | "Էքստրեմալ";
  departurePlace: string;
  departureTime: string;
  returnTime: string;
  price: number;
  oldPrice?: number;
  seatsLeft: number;
  rating: number;
  reviews: number;
  has360: boolean;
  hasAudioGuide: boolean;
  day: "saturday" | "sunday";
  summary: string;
  highlights: string[];
  itinerary: ItineraryStop[];
  included: string[];
  excluded: string[];
  audioChapters: AudioChapter[];
  hotspots: Hotspot[];
};


export const regions = [
  "Գառնի և Գեղարդ",
  "Սևան և Դիլիջան",
  "Տաթև",
];

export const tourTypes = ["Արշավային", "Մշակութային", "Էքստրեմալ"] as const;

const armavirDeparture = "Արմավիր քաղաք, Կենտրոնական հրապարակ";

export const tours: Tour[] = [
  {
    id: "garni",
    title: "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա",
    image: garni,
    region: "Գառնի և Գեղարդ",
    type: "Մշակութային",
    departurePlace: armavirDeparture,
    departureTime: "08:30",
    price: 12000,
    seatsLeft: 3,
    rating: 4.8,
    reviews: 531,
    has360: false,
    hasAudioGuide: true,
    day: "saturday",
  },
  {
    id: "sevan",
    title: "Արմավիր – Սևանա լիճ, Դիլիջան և Հաղարծին",
    image: sevan,
    region: "Սևան և Դիլիջան",
    type: "Մշակութային",
    departurePlace: armavirDeparture,
    departureTime: "08:00",
    price: 15000,
    seatsLeft: 8,
    rating: 4.7,
    reviews: 287,
    has360: true,
    hasAudioGuide: true,
    day: "sunday",
  },
  {
    id: "tatev",
    title: "Արմավիր – Տաթևի վանք և Տաթևեր ճոպանուղի",
    image: tatev,
    region: "Տաթև",
    type: "Մշակութային",
    departurePlace: armavirDeparture,
    departureTime: "07:00",
    price: 22000,
    seatsLeft: 5,
    rating: 4.9,
    reviews: 412,
    has360: true,
    hasAudioGuide: true,
    day: "sunday",
  },
];

export const formatAmd = (value: number) =>
  new Intl.NumberFormat("en-US").format(value) + " ֏";
