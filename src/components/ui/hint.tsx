"use client";

import { Tooltip } from "radix-ui";
import { CircleHelp } from "lucide-react";

/** The (?) beside any piece of jargon: a plain-English explanation on hover, focus or tap. */
export function Hint({ children, label = "What does this mean?" }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip.Provider delayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" aria-label={label} className="inline-flex align-middle text-muted/70 hover:text-ink transition-colors cursor-help">
            <CircleHelp className="size-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            collisionPadding={12}
            className="fade-in z-50 max-w-[280px] rounded-lg bg-ink px-3 py-2 text-[13px] leading-snug font-normal text-white shadow-lg"
          >
            {children}
            <Tooltip.Arrow className="fill-ink" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
