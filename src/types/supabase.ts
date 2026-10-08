import type {
  AttendanceStatus,
  BookingStatus,
  LoyaltyKind,
  PaymentProviderName,
  PaymentState,
  TourIdeaInput,
  TourIdeaResult,
  TourIdeaStatus,
  TourStatus,
  UserRole,
} from "@/types";

type LocalizedTourRow = {
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
  image_url: string | null;
  category: string | null;
  created_at: string;
  departure_place: string | null;
  departure_time: string | null;
  departure_date: string | null;
  status: TourStatus | null;
  guide_id: string | null;
  driver_id: string | null;
};

type LocalizedTourInsert = {
  id: string;
  title_hy?: string;
  title_en?: string;
  title_ru?: string;
  description_hy?: string;
  description_en?: string;
  description_ru?: string;
  location_hy?: string;
  location_en?: string;
  location_ru?: string;
  price?: number;
  image_url?: string | null;
  category?: string | null;
  created_at?: string;
  departure_place?: string | null;
  departure_time?: string | null;
  departure_date?: string | null;
  status?: TourStatus | null;
  guide_id?: string | null;
  driver_id?: string | null;
};

type LocalizedTourUpdate = Partial<LocalizedTourInsert>;

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
          points: number;
          birth_date: string | null;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          role?: UserRole;
          points?: number;
          birth_date?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          role?: UserRole;
          points?: number;
          birth_date?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      tours: {
        Row: LocalizedTourRow;
        Insert: LocalizedTourInsert;
        Update: LocalizedTourUpdate;
        Relationships: [];
      };
      virtual_tours: {
        Row: {
          id: string;
          title_hy: string;
          title_en: string;
          title_ru: string;
          description_hy: string;
          description_en: string;
          description_ru: string;
          embed_url: string | null;
          thumbnail_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          title_hy?: string;
          title_en?: string;
          title_ru?: string;
          description_hy?: string;
          description_en?: string;
          description_ru?: string;
          embed_url?: string | null;
          thumbnail_url?: string | null;
          created_at?: string;
        };
        Update: {
          title_hy?: string;
          title_en?: string;
          title_ru?: string;
          description_hy?: string;
          description_en?: string;
          description_ru?: string;
          embed_url?: string | null;
          thumbnail_url?: string | null;
        };
        Relationships: [];
      };
      departures: {
        Row: {
          id: string;
          tour_id: string;
          departure_date: string;
          available_seats: number;
          guide_id: string | null;
          driver_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          departure_date: string;
          available_seats?: number;
          guide_id?: string | null;
          driver_id?: string | null;
          created_at?: string;
        };
        Update: {
          tour_id?: string;
          departure_date?: string;
          available_seats?: number;
          guide_id?: string | null;
          driver_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "departures_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: false;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "departures_guide_id_fkey";
            columns: ["guide_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "departures_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          id: string;
          user_id: string | null;
          departure_id: string;
          seats_count: number;
          total_price: number;
          used_points: number;
          status: BookingStatus;
          attendance: AttendanceStatus;
          created_at: string;
          tour_id: string | null;
          adults: number;
          children: number;
          seat_number: number;
          amount: number;
          checked_in_at: string | null;
          passenger_name: string | null;
          phone: string | null;
          ticket_code: string | null;
          payment_provider: PaymentProviderName | null;
          payment_status: PaymentState | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          departure_id: string;
          seats_count?: number;
          total_price?: number;
          used_points?: number;
          status?: BookingStatus;
          attendance?: AttendanceStatus;
          created_at?: string;
          passenger_name?: string | null;
          phone?: string | null;
          ticket_code?: string | null;
          payment_provider?: PaymentProviderName | null;
          payment_status?: PaymentState | null;
          tour_id?: string | null;
          adults?: number;
          children?: number;
          seat_number?: number;
          amount?: number;
          checked_in_at?: string | null;
        };
        Update: {
          user_id?: string | null;
          departure_id?: string;
          seats_count?: number;
          total_price?: number;
          used_points?: number;
          status?: BookingStatus;
          attendance?: AttendanceStatus;
          passenger_name?: string | null;
          phone?: string | null;
          ticket_code?: string | null;
          payment_provider?: PaymentProviderName | null;
          payment_status?: PaymentState | null;
          tour_id?: string | null;
          adults?: number;
          children?: number;
          seat_number?: number;
          amount?: number;
          checked_in_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_departure_id_fkey";
            columns: ["departure_id"];
            isOneToOne: false;
            referencedRelation: "departures";
            referencedColumns: ["id"];
          },
        ];
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
      tour_ideas: {
        Row: {
          id: string;
          inputs: TourIdeaInput;
          generated_ideas: TourIdeaResult[];
          status: TourIdeaStatus;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inputs: TourIdeaInput;
          generated_ideas: TourIdeaResult[];
          status?: TourIdeaStatus;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          inputs?: TourIdeaInput;
          generated_ideas?: TourIdeaResult[];
          status?: TourIdeaStatus;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tour_ideas_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "tour_photos_tour_id_fkey";
            columns: ["tour_id"];
            isOneToOne: false;
            referencedRelation: "tours";
            referencedColumns: ["id"];
          },
        ];
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
        Returns: Database["public"]["Tables"]["bookings"]["Row"];
      };
      get_loyalty: {
        Args: { p_phone: string };
        Returns: {
          phone: string;
          full_name: string;
          points: number;
          history: {
            id: string;
            tourId: string | null;
            tourTitle: string | null;
            kind: LoyaltyKind;
            points: number;
            note: string;
            createdAt: string;
          }[];
        };
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
        Returns: {
          phone: string;
          full_name: string;
          points: number;
          history: {
            id: string;
            tourId: string | null;
            tourTitle: string | null;
            kind: LoyaltyKind;
            points: number;
            note: string;
            createdAt: string;
          }[];
          redeemed: number;
          earned: number;
        };
      };
      revert_loyalty: {
        Args: {
          p_phone: string;
          p_redeem: number;
          p_earn: number;
          p_tour_id: string;
        };
        Returns: {
          phone: string;
          full_name: string;
          points: number;
          history: {
            id: string;
            tourId: string | null;
            tourTitle: string | null;
            kind: LoyaltyKind;
            points: number;
            note: string;
            createdAt: string;
          }[];
        };
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
    Enums: {
      user_role: UserRole;
      booking_status: BookingStatus;
      attendance_status: AttendanceStatus;
      tour_status: TourStatus;
      loyalty_kind: LoyaltyKind;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
