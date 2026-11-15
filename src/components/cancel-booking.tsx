import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatAmd } from "@/data/tours";
import { cancelOwnBooking } from "@/lib/guide-api";

/** "Cancel booking" with a confirmation; the server re-checks the 24-hour rule. */
export function CancelBooking({
  bookingId,
  allowed,
  onCancelled,
}: {
  bookingId: string;
  allowed: boolean;
  onCancelled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (!allowed) {
    return (
      <p className="text-xs text-muted-foreground">
        Չեղարկումը հնարավոր է մինչև մեկնումից 24 ժամ առաջ։
      </p>
    );
  }

  const cancel = async () => {
    setPending(true);
    const result = await cancelOwnBooking(bookingId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setOpen(false);
    const parts = ["Ամրագրումը չեղարկվեց, տեղերն ազատվեցին։"];
    if (result.refund > 0) parts.push(`${formatAmd(result.refund)} գումարը կվերադարձվի։`);
    if (result.pointsReturned > 0) parts.push(`${result.pointsReturned} միավորը վերադարձվեց։`);
    toast.success(parts.join(" "));
    onCancelled();
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full font-bold text-destructive">
          Չեղարկել ամրագրումը
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Չեղարկե՞լ ամրագրումը</AlertDialogTitle>
          <AlertDialogDescription>
            Տեղերը կազատվեն այլ ճամփորդների համար, վճարված գումարը կվերադարձվի, իսկ օգտագործված
            միավորները կվերադառնան ձեր հաշվին։ Այս քայլը հետ բերել հնարավոր չէ։
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Ոչ, թողնել</AlertDialogCancel>
          <Button
            variant="destructive"
            className="font-bold"
            disabled={pending}
            onClick={() => void cancel()}
          >
            {pending ? "Չեղարկվում է" : "Այո, չեղարկել"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
