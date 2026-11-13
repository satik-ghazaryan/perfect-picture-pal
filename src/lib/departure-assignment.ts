export type LegacyTourStaff = {
  id: string;
  departureDate: string | null;
  guideId: string | null;
  driverId: string | null;
};

export type ExistingDeparture = {
  id: string;
  tourId: string;
  departureDate: string;
  guideId: string | null;
  driverId: string | null;
};

export type AccountRole = {
  id: string;
  role: string;
};

export type DepartureAssignmentConflict = {
  tourId: string;
  reason: string;
};

export type DepartureAssignmentApply = {
  tourId: string;
  departureId: string | null;
  departureDate: string;
  guideId: string | null;
  driverId: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isExplicitDepartureDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function assigneeRoleError(expected: "guide" | "driver", role: string | null) {
  if (role === expected) return null;
  return expected === "guide" ? "Ընտրված հաշիվը զբոսավար չէ։" : "Ընտրված հաշիվը վարորդ չէ։";
}

function roleOf(accounts: AccountRole[], id: string | null) {
  if (!id) return null;
  return accounts.find((account) => account.id === id)?.role ?? null;
}

export function planLegacyDepartureLinks(
  tours: LegacyTourStaff[],
  departures: ExistingDeparture[],
  accounts: AccountRole[],
): { apply: DepartureAssignmentApply[]; conflicts: DepartureAssignmentConflict[] } {
  const apply: DepartureAssignmentApply[] = [];
  const conflicts: DepartureAssignmentConflict[] = [];
  for (const tour of tours) {
    if (!tour.guideId && !tour.driverId) continue;
    const date =
      tour.departureDate && isExplicitDepartureDate(tour.departureDate) ? tour.departureDate : null;
    if (!date) {
      conflicts.push({
        tourId: tour.id,
        reason: "Տուրի աշխատակիցը կա, բայց միանշանակ մեկնման ամսաթիվ չկա։",
      });
      continue;
    }
    const guideRole = roleOf(accounts, tour.guideId);
    const driverRole = roleOf(accounts, tour.driverId);
    if (tour.guideId && guideRole !== "guide") {
      conflicts.push({ tourId: tour.id, reason: "Տուրի guide_id հաշիվը զբոսավար չէ։" });
      continue;
    }
    if (tour.driverId && driverRole !== "driver") {
      conflicts.push({ tourId: tour.id, reason: "Տուրի driver_id հաշիվը վարորդ չէ։" });
      continue;
    }
    const sameDay = departures.filter(
      (item) => item.tourId === tour.id && item.departureDate === date,
    );
    if (sameDay.length > 1) {
      conflicts.push({ tourId: tour.id, reason: "Նույն օրվա մեկից ավելի մեկնում կա։" });
      continue;
    }
    const current = sameDay[0] ?? null;
    if (current?.guideId && tour.guideId && current.guideId !== tour.guideId) {
      conflicts.push({
        tourId: tour.id,
        reason: "Մեկնման զբոսավարը տարբերվում է տուրի guide_id-ից։",
      });
      continue;
    }
    if (current?.driverId && tour.driverId && current.driverId !== tour.driverId) {
      conflicts.push({
        tourId: tour.id,
        reason: "Մեկնման վարորդը տարբերվում է տուրի driver_id-ից։",
      });
      continue;
    }
    apply.push({
      tourId: tour.id,
      departureId: current?.id ?? null,
      departureDate: date,
      guideId: current?.guideId ?? tour.guideId,
      driverId: current?.driverId ?? tour.driverId,
    });
  }
  return { apply, conflicts };
}
