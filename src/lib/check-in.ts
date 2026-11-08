import type { AttendanceStatus } from "@/lib/database.types";

export function planPassengerCheckIn(input: {
  assigned: boolean;
  foundOnDeparture: boolean;
  attendance: AttendanceStatus | null;
  passengerName: string;
}) {
  if (!input.assigned || !input.foundOnDeparture) {
    return { action: "reject" as const, message: "Այս մեկնման ուղևորացուցակում այդպիսի տոմս չկա։" };
  }
  if (input.attendance === "present") {
    return {
      action: "repeat" as const,
      message: `${input.passengerName} արդեն ներկա է։`,
    };
  }
  return {
    action: "mark" as const,
    attendance: "present" as const,
    message: `${input.passengerName} ներկա է։`,
  };
}
