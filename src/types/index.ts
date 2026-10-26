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
  title_en?: string;
  description: string;
};

export type TourIdeaBreakdown = {
  transport_amd: number;
  meals_amd: number;
  entrance_fees_amd: number;
  guide_amd: number;
  other_amd: number;
  yerevan_transfer_amd?: number;
  notes: string;
};

export type TourIdeaProfitability = {
  group_size: number;
  revenue_per_person_amd: number;
  expense_per_person_amd: number;
  profit_per_person_amd: number;
  revenue_per_group_amd: number;
  expense_per_group_amd: number;
  profit_per_group_amd: number;
  assumptions: string;
  confidence: "estimated" | "needs_verification";
};

export type TourIdeaMarketPosition = "below_market" | "in_range" | "above_market" | "unknown";

export type TourIdeaMarketOffer = {
  title: string;
  url: string;
  observed_price_amd: number;
  found_on: string;
  label: string;
  snippet?: string;
};

export type TourIdeaMarket = {
  label: string;
  offer_count: number;
  price_min_amd: number | null;
  price_median_amd: number | null;
  price_max_amd: number | null;
  difference_amd: number;
  offers: TourIdeaMarketOffer[];
};

export type TourIdeaResearchHit = {
  title: string;
  url: string;
  snippet: string;
  query?: string;
  kind?: string;
};

export type TourIdeaResearch = {
  live: boolean;
  provider: string;
  retrieved_at: string;
  disclaimer: string;
  queries: string[];
  results: TourIdeaResearchHit[];
  market_offers: TourIdeaMarketOffer[];
  error?: string;
  search_status?: string;
  tavily_key_present?: boolean;
  useful_result_count?: number;
  provider_status?: {
    tavily?: string;
    ddg?: string;
    tavily_key_present?: boolean;
  };
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
  price: number | null;
  duration_hours: number;
  highlights: string[];
  itinerary: TourIdeaStop[];
  breakdown?: TourIdeaBreakdown;
  profitability?: TourIdeaProfitability;
  budget_score?: number;
  logistics_score?: number;
  appeal_score?: number;
  quality_score?: number;
  budget_fit?: "within" | "over";
  notes?: string;
  verify?: string[];
  needs_verification?: boolean;
  source_urls?: string[];
  route_km?: number;
  transport_rate_per_km_amd?: number;
  cost_per_person_amd?: number;
  min_price_amd?: number;
  market_position?: TourIdeaMarketPosition;
  market?: TourIdeaMarket;
};
