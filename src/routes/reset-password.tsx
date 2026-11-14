import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mayResetOwnPassword, validNewPassword } from "@/lib/password-reset";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Նոր գաղտնաբառ — Արի Գնանք" }, { name: "robots", content: "noindex" }],
  }),
  component: ResetPasswordPage,
});

type Stage = "checking" | "form" | "no-link" | "staff" | "done";

function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setStage("no-link");
      return;
    }
    const client = supabase;
    let cancelled = false;

    const open = async (userId: string) => {
      const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (cancelled) return;
      if (!mayResetOwnPassword(data?.role)) {
        await client.auth.signOut();
        if (!cancelled) setStage("staff");
        return;
      }
      setStage("form");
    };

    // The link in the email signs the person in; wait for that before showing the form.
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session?.user.id) {
        void open(session.user.id);
      }
    });
    const timer = window.setTimeout(() => {
      void client.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (data.session?.user.id) void open(data.session.user.id);
        else setStage((current) => (current === "checking" ? "no-link" : current));
      });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      listener.subscription.unsubscribe();
    };
  }, []);

  const save = async () => {
    const problem = validNewPassword(password, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    if (!supabase) return;
    setPending(true);
    setError("");
    try {
      const { error: failed } = await supabase.auth.updateUser({ password });
      if (failed) {
        setError(
          /different|same/i.test(failed.message)
            ? "Նոր գաղտնաբառը պետք է տարբերվի հնից։"
            : "Գաղտնաբառը չփոխվեց։ Խնդրեք նոր հղում և փորձեք նորից։",
        );
        return;
      }
      setStage("done");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-black tracking-tight">Նոր գաղտնաբառ</h1>
        <div className="mt-6 rounded-3xl border border-border bg-card p-5">
          {stage === "checking" && (
            <p className="text-sm text-muted-foreground">Հղումը ստուգվում է...</p>
          )}
          {stage === "no-link" && (
            <div className="space-y-3 text-sm">
              <p>
                Հղումն այլևս չի գործում կամ արդեն օգտագործվել է։ Մուտքի էջում սեղմեք «Մոռացե՞լ եք
                գաղտնաբառը» և խնդրեք նոր հղում։
              </p>
              <Link
                to="/login"
                search={{ redirect: "/profile" }}
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Բացել մուտքի էջը
              </Link>
            </div>
          )}
          {stage === "staff" && (
            <p className="text-sm">
              Զբոսավարի և վարորդի գաղտնաբառը փոխում է ադմինիստրատորը։ Դիմեք նրան նոր գաղտնաբառի
              համար։
            </p>
          )}
          {stage === "form" && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="new-password">Նոր գաղտնաբառ</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  className="h-11 rounded-2xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="repeat-password">Կրկնեք գաղտնաբառը</Label>
                <Input
                  id="repeat-password"
                  type="password"
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                  autoComplete="new-password"
                  className="h-11 rounded-2xl"
                />
              </div>
              {error && <p className="text-xs font-medium text-destructive">{error}</p>}
              <Button
                type="submit"
                className="h-11 w-full rounded-full font-bold"
                disabled={pending}
              >
                {pending ? "Պահվում է" : "Պահպանել նոր գաղտնաբառը"}
              </Button>
            </form>
          )}
          {stage === "done" && (
            <div className="space-y-3 text-sm">
              <p className="font-semibold">Գաղտնաբառը փոխվեց։</p>
              <Link
                to="/profile"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Բացել իմ էջը և ամրագրումները
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
