export type UserRole = "tourist" | "guide" | "driver" | "admin";
export type BookingStatus = "booked" | "checked_in";
export type AttendanceStatus = "present" | "absent" | "pending";
export type PaymentProviderName = "idram" | "telcell" | "arca";
export type PaymentState = "SUCCESS" | "FAILED" | "PENDING";
export type TourStatus = "scheduled" | "in_progress" | "completed";
export type LoyaltyKind = "earn" | "redeem";

export type Tour = {
  id: string;
  title_hy: string;
  title_en: string;
  title_ru: string;
  description_hy: string;
  description_en: string;
  description_ru: string;
  location_hy: string;
  location_en: string;
  location_ru: string;
  price: number;
  image_url: string;
  category: string;
  created_at?: string;
};

export type VirtualTour = {
  id: string;
  title_hy: string;
  title_en: string;
  title_ru: string;
  description_hy: string;
  description_en: string;
  description_ru: string;
  embed_url: string | null;
  thumbnail_url: string | null;
  created_at?: string;
};

export type UserProfile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  points: number;
  birth_date: string | null;
  avatar_url: string | null;
  bio: string | null;
};

export type Departure = {
  id: string;
  tour_id: string;
  departure_date: string;
  available_seats: number;
  guide_id: string | null;
  driver_id: string | null;
};

export type Booking = {
  id: string;
  user_id: string | null;
  departure_id: string;
  seats_count: number;
  total_price: number;
  used_points: number;
  status: BookingStatus;
  attendance: AttendanceStatus;
};

export type TourIdeaStatus = "draft" | "approved" | "rejected";

export type TourIdeaInput = {
  season: string;
  target_audience: string;
  tour_type: string;
  duration_days: number;
  budget_amd: number;
  departure_location: string;
  preferences: string;
  count: number;
};

export type TourIdeaStop = {
  time: string;
  title: string;
  description: string;
};

export type TourIdeaResult = {
  id: string;
  title_hy: string;
  title_en: string;
  title_ru: string;
  description_hy: string;
  description_en: string;
  description_ru: string;
  location_hy: string;
  location_en: string;
  location_ru: string;
  price: number;
  duration_hours: number;
  highlights: string[];
  itinerary: TourIdeaStop[];
  budget_score?: number;
  logistics_score?: number;
  appeal_score?: number;
  notes?: string;
};
