import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAdmin, signInMockAdmin } from "@/lib/admin";
import { isSupabaseConfigured } from "@/lib/supabase";

export function AdminLogin() {
  const [email, setEmail] = useState("admin@arignank.am");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInAdmin(email, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Մուտքը չհաջողվեց։");
    } finally {
      setBusy(false);
    }
  };

  const mock = async () => {
    setBusy(true);
    setError("");
    try {
      await signInMockAdmin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Մուտքը չհաջողվեց։");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-2xl font-black tracking-tight">Ադմինիստրատոր</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isSupabaseConfigured
            ? "Մուտք գործեք ադմինի դերով հաշվով։"
            : "Տեղային նախադիտում. admin@arignank.am և առնվազն 4 նիշ գաղտնաբառ։"}
        </p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Էլ. փոստ</Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-2xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Գաղտնաբառ</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-2xl"
            />
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <Button type="submit" className="w-full rounded-full font-bold" disabled={busy}>
            {busy ? "Մտնում է" : "Մուտք"}
          </Button>
        </form>
        {!isSupabaseConfigured && (
          <Button type="button" variant="outline" className="mt-3 w-full rounded-full" disabled={busy} onClick={() => void mock()}>
            Մտնել որպես ադմին
          </Button>
        )}
      </div>
    </div>
  );
}
