export type UserRole = "guide" | "driver" | "customer" | "admin";
export type PaymentProviderName = "idram" | "telcell" | "arca";
export type PaymentState = "SUCCESS" | "FAILED" | "PENDING";
export type TourStatus = "scheduled" | "in_progress" | "completed";
export type BookingStatus = "booked" | "checked_in";
export type LoyaltyKind = "earn" | "redeem";

export type LoyaltyEntryRow = {
  id: string;
  tourId: string | null;
  tourTitle: string | null;
  kind: LoyaltyKind;
  points: number;
  note: string;
  createdAt: string;
};

export type LoyaltyAccountRow = {
  phone: string;
  full_name: string;
  points: number;
  history: LoyaltyEntryRow[];
};

export type BookingRow = {
  id: string;
  tour_id: string;
  passenger_name: string;
  phone: string;
  seat_number: number;
  ticket_code: string;
  status: BookingStatus;
  adults: number;
  children: number;
  checked_in_at: string | null;
  payment_provider: string | null;
  payment_status: string | null;
  amount: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          role: UserRole;
        };
        Insert: {
          id: string;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          role?: UserRole;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          role?: UserRole;
        };
        Relationships: [];
      };
      tours: {
        Row: {
          id: string;
          title: string;
          departure_place: string;
          departure_time: string;
          departure_date: string;
          status: TourStatus;
          guide_id: string | null;
          driver_id: string | null;
          price: number;
          seats: number;
          image_url: string | null;
          panorama_url: string | null;
          summary: string | null;
          region: string | null;
          day: string | null;
          itinerary: unknown;
          audio_chapters: unknown;
        };
        Insert: {
          id: string;
          title: string;
          departure_place: string;
          departure_time: string;
          departure_date: string;
          status?: TourStatus;
          guide_id?: string | null;
          driver_id?: string | null;
          price?: number;
          seats?: number;
          image_url?: string | null;
          panorama_url?: string | null;
          summary?: string | null;
          region?: string | null;
          day?: string | null;
          itinerary?: unknown;
          audio_chapters?: unknown;
        };
        Update: {
          title?: string;
          departure_place?: string;
          departure_time?: string;
          departure_date?: string;
          status?: TourStatus;
          guide_id?: string | null;
          driver_id?: string | null;
          price?: number;
          seats?: number;
          image_url?: string | null;
          panorama_url?: string | null;
          summary?: string | null;
          region?: string | null;
          day?: string | null;
          itinerary?: unknown;
          audio_chapters?: unknown;
        };
        Relationships: [];
      };
      bookings: {
        Row: BookingRow;
        Insert: {
          id?: string;
          tour_id: string;
          passenger_name: string;
          phone: string;
          seat_number: number;
          ticket_code: string;
          status?: BookingStatus;
          adults?: number;
          children?: number;
          checked_in_at?: string | null;
          payment_provider?: string | null;
          payment_status?: string | null;
          amount?: number;
        };
        Update: {
          passenger_name?: string;
          phone?: string;
          seat_number?: number;
          ticket_code?: string;
          status?: BookingStatus;
          adults?: number;
          children?: number;
          checked_in_at?: string | null;
          payment_provider?: string | null;
          payment_status?: string | null;
          amount?: number;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          id: number;
          banner_title: string;
          banner_text: string;
          departure_place: string;
          cashback_percent: number;
        };
        Insert: {
          id?: number;
          banner_title: string;
          banner_text: string;
          departure_place: string;
          cashback_percent: number;
        };
        Update: {
          banner_title?: string;
          banner_text?: string;
          departure_place?: string;
          cashback_percent?: number;
        };
        Relationships: [];
      };
      tour_photos: {
        Row: {
          id: string;
          tour_id: string;
          url: string;
          uploaded_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          url: string;
          uploaded_by: string;
          created_at?: string;
        };
        Update: {
          url?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_booking: {
        Args: {
          p_tour_id: string;
          p_passenger_name: string;
          p_phone: string;
          p_ticket_code: string;
          p_adults: number;
          p_children: number;
        };
        Returns: BookingRow;
      };
      get_loyalty: {
        Args: { p_phone: string };
        Returns: LoyaltyAccountRow;
      };
      apply_loyalty: {
        Args: {
          p_phone: string;
          p_name: string;
          p_redeem: number;
          p_earn: number;
          p_tour_id: string;
          p_tour_title: string;
          p_cashback_percent: number;
        };
        Returns: LoyaltyAccountRow & { redeemed: number; earned: number };
      };
      revert_loyalty: {
        Args: {
          p_phone: string;
          p_redeem: number;
          p_earn: number;
          p_tour_id: string;
        };
        Returns: LoyaltyAccountRow;
      };
      set_booking_payment: {
        Args: {
          p_ticket_code: string;
          p_provider: string;
          p_status: string;
          p_amount: number;
        };
        Returns: null;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
