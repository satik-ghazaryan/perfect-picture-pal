export type {
  AttendanceStatus,
  BookingStatus,
  LoyaltyKind,
  PaymentProviderName,
  PaymentState,
  TourStatus,
  UserRole,
} from "@/types";
export type { Database, Tables, TablesInsert, TablesUpdate } from "@/types/supabase";

import type { AttendanceStatus, BookingStatus, LoyaltyKind } from "@/types";

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
  user_id: string | null;
  departure_id: string;
  seats_count: number;
  total_price: number;
  used_points: number;
  status: BookingStatus;
  attendance: AttendanceStatus;
  passenger_name?: string | null;
  phone?: string | null;
  ticket_code?: string | null;
};
