import { useSyncExternalStore } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { crewRevealed, formatTimeRemaining, timeUntilDeparture } from "@/lib/crew";
import {
  getAdminServerSnapshot,
  getAdminSnapshot,
  subscribeAdmin,
  type DirectoryUser,
} from "@/lib/admin";

const hiddenNote = "Զբոսավարի և վարորդի տվյալները հասանելի կլինեն մեկնումից 1 օր առաջ";

function initials(name: string) {
  const letter = name.trim().charAt(0);
  return letter || "•";
}

function Person({ label, person }: { label: string; person: DirectoryUser | null }) {
  if (!person) {
    return (
      <article className="rounded-2xl bg-muted px-3 py-3">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm">Դեռ նշանակված չէ։</p>
      </article>
    );
  }

  return (
    <article className="flex gap-3 rounded-2xl bg-muted px-3 py-3">
      <Avatar className="h-14 w-14">
        {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-sm font-bold">{initials(person.fullName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold">{person.fullName}</p>
        <p className="mt-0.5 text-xs">{person.phone || "Հեռախոսը նշված չէ"}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {person.bio || "Համառոտ նկարագրություն դեռ չկա։"}
        </p>
      </div>
    </article>
  );
}

export function DepartureCrew({
  departureDate,
  departureTime,
  guideId,
  driverId,
}: {
  departureDate: string;
  departureTime: string;
  guideId: string | null;
  driverId: string | null;
}) {
  const users = useSyncExternalStore(subscribeAdmin, getAdminSnapshot, getAdminServerSnapshot).users;
  const remaining = timeUntilDeparture(departureDate, departureTime);
  const revealed = crewRevealed(departureDate, departureTime);
  const guide = users.find((user) => user.id === guideId && user.role === "guide") ?? null;
  const driver = users.find((user) => user.id === driverId && user.role === "driver") ?? null;

  return (
    <section className="rounded-3xl border border-border bg-card p-4">
      {remaining !== null && (
        <p className="text-xs font-semibold text-muted-foreground">{formatTimeRemaining(remaining)}</p>
      )}
      {revealed ? (
        <>
          <h2 className="mt-1 text-base font-black">Ձեր զբոսավարը և վարորդը</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Person label="Զբոսավար" person={guide} />
            <Person label="Վարորդ" person={driver} />
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{hiddenNote}</p>
      )}
    </section>
  );
}
