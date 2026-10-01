import { useState } from "react";
import { Bus, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  sendPhoneCode,
  signInWithEmail,
  verifyPhoneCode,
  type StaffProfile,
} from "@/lib/guide-api";
import { cn } from "@/lib/utils";

export function GuideLogin() {
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [role, setRole] = useState<StaffProfile["role"]>("guide");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submitEmail = async () => {
    setPending(true);
    setError("");
    try {
      await signInWithEmail(email, password, role);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Մուտքը չհաջողվեց։");
    } finally {
      setPending(false);
    }
  };

  const submitPhone = async () => {
    setPending(true);
    setError("");
    try {
      if (!codeSent) {
        await sendPhoneCode(phone);
        setCodeSent(true);
        return;
      }
      await verifyPhoneCode(phone, code, role);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Մուտքը չհաջողվեց։");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Bus className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-black">Ուղեկցորդ և վարորդ</h1>
          <p className="text-xs text-muted-foreground">Մուտք Արմավիրից մեկնող տուրերի պորտալ</p>
        </div>
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-4 rounded-2xl bg-primary-soft px-3 py-2 text-xs text-foreground">
          Supabase-ը դեռ միացված չէ։ Այս մուտքը բացում է տեղային պորտալը՝ նույն տուրերով և տոմսերով։
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 rounded-full bg-muted p-1">
        {(
          [
            ["email", "Էլ. փոստ"],
            ["phone", "Հեռախոս"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMethod(value);
              setError("");
            }}
            className={cn(
              "rounded-full px-3 py-2 text-sm font-bold",
              method === value ? "bg-card text-primary shadow-card" : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {!isSupabaseConfigured && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(
            [
              ["guide", "Ուղեկցորդ"],
              ["driver", "Վարորդ"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className={cn(
                "rounded-2xl border px-3 py-2 text-sm font-bold",
                role === value ? "border-primary bg-primary-soft text-primary" : "border-border",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {method === "email" ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitEmail();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="guide-email">Էլ. փոստ</Label>
            <Input
              id="guide-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="guide@arignank.am"
              className="h-11 rounded-2xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guide-password">Գաղտնաբառ</Label>
            <Input
              id="guide-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 rounded-2xl"
            />
          </div>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button type="submit" className="h-11 w-full rounded-full font-bold" disabled={pending}>
            Մուտք
          </Button>
        </form>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitPhone();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="guide-phone">Հեռախոսահամար</Label>
            <Input
              id="guide-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+374 00 000000"
              className="h-11 rounded-2xl"
              disabled={codeSent && isSupabaseConfigured}
            />
          </div>
          {codeSent && (
            <div className="space-y-1.5">
              <Label htmlFor="guide-otp">Հաստատման կոդ</Label>
              <Input
                id="guide-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="000000"
                className="h-11 rounded-2xl tracking-[0.3em]"
              />
            </div>
          )}
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button type="submit" className="h-11 w-full rounded-full font-bold" disabled={pending}>
            <Phone className="h-4 w-4" />
            {codeSent ? "Հաստատել" : "Ուղարկել կոդը"}
          </Button>
        </form>
      )}
    </div>
  );
}
