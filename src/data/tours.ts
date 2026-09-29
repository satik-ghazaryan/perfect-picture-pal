import tatev from "@/assets/tour-tatev.jpg";
import sevan from "@/assets/tour-sevan.jpg";
import garni from "@/assets/tour-garni.jpg";

export type Tour = {
  id: string;
  title: string;
  image: string;
  region: string;
  type: "Hiking" | "Cultural" | "Extreme";
  departurePlace: string;
  departureTime: string;
  price: number;
  oldPrice?: number;
  seatsLeft: number;
  rating: number;
  reviews: number;
  has360: boolean;
  hasAudioGuide: boolean;
  day: "saturday" | "sunday";
};

export const regions = [
  "Tatev & Khndzoresk",
  "Sevan & Dilijan",
  "Garni & Geghard",
  "Areni & Noravank",
];

export const tourTypes = ["Hiking", "Cultural", "Extreme"] as const;

export const tours: Tour[] = [
  {
    id: "tatev",
    title: "Tatev Monastery & Wings of Tatev Ropeway",
    image: tatev,
    region: "Tatev & Khndzoresk",
    type: "Cultural",
    departurePlace: "Republic Square",
    departureTime: "08:30",
    price: 24000,
    oldPrice: 29000,
    seatsLeft: 3,
    rating: 4.9,
    reviews: 412,
    has360: true,
    hasAudioGuide: true,
    day: "saturday",
  },
  {
    id: "sevan",
    title: "Lake Sevan, Dilijan & Haghartsin Forest Walk",
    image: sevan,
    region: "Sevan & Dilijan",
    type: "Hiking",
    departurePlace: "Yeritasardakan Metro",
    departureTime: "09:00",
    price: 15500,
    seatsLeft: 11,
    rating: 4.7,
    reviews: 287,
    has360: true,
    hasAudioGuide: true,
    day: "sunday",
  },
  {
    id: "garni",
    title: "Garni Temple, Geghard & Symphony of Stones",
    image: garni,
    region: "Garni & Geghard",
    type: "Cultural",
    departurePlace: "Republic Square",
    departureTime: "08:30",
    price: 12000,
    oldPrice: 14000,
    seatsLeft: 6,
    rating: 4.8,
    reviews: 531,
    has360: false,
    hasAudioGuide: true,
    day: "saturday",
  },
  {
    id: "azat-zipline",
    title: "Azat Gorge Zipline & Off-Road Adventure",
    image: garni,
    region: "Garni & Geghard",
    type: "Extreme",
    departurePlace: "Northern Avenue",
    departureTime: "07:45",
    price: 32000,
    seatsLeft: 2,
    rating: 4.6,
    reviews: 98,
    has360: true,
    hasAudioGuide: false,
    day: "sunday",
  },
  {
    id: "noravank",
    title: "Areni Wine Cave & Noravank Canyon",
    image: sevan,
    region: "Areni & Noravank",
    type: "Cultural",
    departurePlace: "Republic Square",
    departureTime: "08:00",
    price: 18000,
    seatsLeft: 14,
    rating: 4.8,
    reviews: 203,
    has360: false,
    hasAudioGuide: true,
    day: "sunday",
  },
  {
    id: "khustup",
    title: "Mount Khustup Summit Day Hike",
    image: tatev,
    region: "Tatev & Khndzoresk",
    type: "Hiking",
    departurePlace: "Kilikia Bus Station",
    departureTime: "06:30",
    price: 21000,
    seatsLeft: 5,
    rating: 4.9,
    reviews: 76,
    has360: false,
    hasAudioGuide: false,
    day: "saturday",
  },
];

export const formatAmd = (value: number) =>
  new Intl.NumberFormat("en-US").format(value) + " ֏";
