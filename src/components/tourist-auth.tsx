import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { registerTourist, signInTourist } from "@/lib/admin";

const months = [
  "Հունվար",
  "Փետրվար",
  "Մարտ",
  "Ապրիլ",
  "Մայիս",
  "Հունիս",
  "Հուլիս",
  "Օգոստոս",
  "Սեպտեմբեր",
  "Հոկտեմբեր",
  "Նոյեմբեր",
  "Դեկտեմբեր",
];

const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 1939 }, (_, index) => String(currentYear - index));

function birthDate(year: string, month: string, day: string) {
  if (!year || !month || !day) return null;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (date.getTime() > Date.now()) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function TouristAuthForm({
  onSuccess,
  compact = false,
  loginTitle = "Մուտք համակարգ",
}: {
  onSuccess: () => void;
  compact?: boolean;
  loginTitle?: string;
}) {
  const [tab, setTab] = useState("login");
  const [identifier, setIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const signIn = async () => {
    setPending(true);
    setError("");
    try {
      await signInTourist(identifier, loginPassword);
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Մուտքը չստացվեց։");
    } finally {
      setPending(false);
    }
  };

  const signUp = async () => {
    const date = birthDate(year, month, day);
    if (!date) {
      setError("Ընտրեք իրական ծննդյան ամսաթիվ։");
      return;
    }
    setPending(true);
    setError("");
    try {
      await registerTourist({ fullName, phone, birthDate: date, email, password });
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Գրանցումը չպահվեց։");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={compact ? "" : "mt-6"}>
      {!compact && (
        <div className="mb-6">
          <h1 className="text-3xl font-black tracking-tight">{tab === "login" ? loginTitle : "Գրանցում"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tab === "login"
              ? "Մուտք գործեք էլ. փոստով կամ հեռախոսահամարով։"
              : "Հաշիվը ստեղծվում է որպես զբոսաշրջիկ։ Դրանով կարող եք ամրագրել մեկօրյա տուր Արմավիրից։"}
          </p>
        </div>
      )}
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next);
          setError("");
        }}
        className="rounded-3xl border border-border bg-card p-5"
      >
        <TabsList className="grid h-11 w-full grid-cols-2 rounded-full">
          <TabsTrigger value="login" className="rounded-full">Մուտք</TabsTrigger>
          <TabsTrigger value="signup" className="rounded-full">Գրանցում</TabsTrigger>
        </TabsList>

        <TabsContent value="login">
          <form
            className="space-y-3 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              void signIn();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="login-identifier">Էլ․ փոստ / Հեռախոս</Label>
              <Input
                id="login-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                placeholder="name@mail.am կամ +374 00 000000"
                className="h-11 rounded-2xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Գաղտնաբառ</Label>
              <Input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                className="h-11 rounded-2xl"
              />
            </div>
            {error && tab === "login" && <p className="text-xs font-medium text-destructive">{error}</p>}
            <Button type="submit" className="h-11 w-full rounded-full font-bold" disabled={pending}>
              {pending ? "Մուտք է գործում" : "Մուտք"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="signup">
          <form
            className="space-y-3 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              void signUp();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="reg-name">Անուն Ազգանուն</Label>
              <Input id="reg-name" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" className="h-11 rounded-2xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-phone">Հեռախոսահամար</Label>
              <Input id="reg-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="+374 00 000000" className="h-11 rounded-2xl" />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Ծննդյան ամսաթիվ</legend>
              <div className="grid grid-cols-3 gap-2">
                <Select {...(day ? { value: day } : {})} onValueChange={setDay}>
                  <SelectTrigger aria-label="Օր" className="rounded-2xl">
                    <SelectValue placeholder="Օր" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, index) => String(index + 1)).map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select {...(month ? { value: month } : {})} onValueChange={setMonth}>
                  <SelectTrigger aria-label="Ամիս" className="rounded-2xl">
                    <SelectValue placeholder="Ամիս" />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select {...(year ? { value: year } : {})} onValueChange={setYear}>
                  <SelectTrigger aria-label="Տարի" className="rounded-2xl">
                    <SelectValue placeholder="Տարի" />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="reg-email">Էլ. փոստ</Label>
              <Input id="reg-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="h-11 rounded-2xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-password">Գաղտնաբառ</Label>
              <Input id="reg-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="h-11 rounded-2xl" />
            </div>
            {error && tab === "signup" && <p className="text-xs font-medium text-destructive">{error}</p>}
            <Button type="submit" className="h-11 w-full rounded-full font-bold" disabled={pending}>
              {pending ? "Գրանցվում է" : "Գրանցվել"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
