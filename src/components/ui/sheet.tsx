"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";

/** Right-hand drawer (shadcn-style Sheet on Radix Dialog). */
export function Sheet({
  open, onOpenChange, title, description, children,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-black/25" />
        <Dialog.Content className="sheet-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col bg-white shadow-2xl outline-none">
          <div className="flex items-start justify-between gap-4 border-b border-line px-8 py-6">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-wash hover:text-ink cursor-pointer">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
