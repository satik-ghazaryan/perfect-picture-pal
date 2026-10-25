import { pickLocale, useSiteLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

const copy = {
  hy: "Թեստային ռեժիմ. իրական գումար չի գանձվում",
  en: "Test mode: no real money is charged",
  ru: "Тестовый режим: реальные деньги не списываются",
};

export function isPaymentSandbox() {
  return import.meta.env.VITE_PAYMENT_MODE !== "live";
}

export function TestModeNotice({ className }: { className?: string }) {
  const lang = useSiteLocale();
  if (!isPaymentSandbox()) return null;
  return (
    <p
      role="status"
      className={cn(
        "bg-accent px-3 py-1.5 text-center text-xs font-semibold text-accent-foreground",
        className,
      )}
    >
      {pickLocale(copy, lang)}
    </p>
  );
}
