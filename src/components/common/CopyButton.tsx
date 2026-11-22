"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function CopyButton({
  value,
  label,
  variant = "outline",
  size = "default",
  className,
}: {
  value: string;
  label: string;
  variant?: "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "icon";
  className?: string;
}) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast.success(t("common.copied"));
      setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }
  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={className} aria-label={size === "icon" ? label : undefined}>
      {done ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
      {size !== "icon" && label}
    </Button>
  );
}
