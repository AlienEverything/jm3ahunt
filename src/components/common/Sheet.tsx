"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useMediaQuery } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Actions under the scrollable body. */
  footer?: ReactNode;
  className?: string;
}

/** Bottom sheet on phones, centred dialog from 640 px up (SPEC §11). */
export function Sheet({ open, onOpenChange, title, description, children, footer, className }: SheetProps) {
  const desktop = useMediaQuery("(min-width: 640px)");
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("flex max-h-[min(90dvh,720px)] flex-col gap-0 p-0 sm:max-w-lg", className)}>
          <DialogHeader className="px-5 pt-5 pb-3 pe-12">
            <DialogTitle className="text-lg leading-snug font-semibold">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className={className}>
        <DrawerHeader className="px-5 pt-2 pb-3 text-start group-data-[swipe-axis=y]/drawer-popup:text-start">
          <DrawerTitle className="text-lg font-semibold">{title}</DrawerTitle>
          {description && <DrawerDescription className="text-start">{description}</DrawerDescription>}
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer ? <div className="flex flex-col gap-2 border-t px-5 pt-3 pb-safe">{footer}</div> : <div className="pb-safe" />}
      </DrawerContent>
    </Drawer>
  );
}
