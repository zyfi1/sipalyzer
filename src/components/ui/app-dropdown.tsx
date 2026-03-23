import * as React from "react";

import { ChevronDownIcon, MoreHorizontal } from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DropdownControlTrigger, type DropdownControlSize } from "@/components/ui/dropdown-control";

export type AppDropdownOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  /** Passed to `SelectItem` for this row */
  itemClassName?: string;
};

export type { DropdownControlSize as AppDropdownSize };

type AppDropdownSelectProps = {
  mode?: "select";
  size?: DropdownControlSize;
  /** Omit for uncontrolled selects (placeholder persists after each pick). */
  value?: string;
  onValueChange: (value: string) => void;
  /** Simple rows; ignored when `contentChildren` is set. */
  options?: AppDropdownOption[];
  /** Custom popover body; use exported `SelectItem` for rows. */
  contentChildren?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Rendered inside the trigger before the value (e.g. icon) */
  triggerPrefix?: React.ReactNode;
  /** Extra `SelectValue` children (custom trigger label). */
  valueDisplay?: React.ReactNode;
  /** Radix `SelectContent` alignment (default **start** — stable with full-width triggers) */
  contentAlign?: React.ComponentProps<typeof SelectContent>["align"];
  /** Default **popper** — consistent anchor; `item-aligned` can feel jumpy as selection changes */
  contentPosition?: React.ComponentProps<typeof SelectContent>["position"];
  sideOffset?: React.ComponentProps<typeof SelectContent>["sideOffset"];
  collisionPadding?: React.ComponentProps<typeof SelectContent>["collisionPadding"];
  /** Applied to every `SelectItem` unless overridden per option */
  itemClassName?: string;
  contentClassName?: string;
  name?: string;
  required?: boolean;
};

type AppDropdownMenuProps = {
  mode: "menu";
  size?: DropdownControlSize;
  /** Visible label next to the optional icon */
  triggerLabel: React.ReactNode;
  /** Default: ellipsis. Pass `null` to omit leading icon. */
  triggerIcon?: React.ReactNode | null;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
};

export type AppDropdownProps = AppDropdownSelectProps | AppDropdownMenuProps;

function menuChevronClass(size: DropdownControlSize): string {
  if (size === "sm") return "size-3.5 shrink-0 text-muted-foreground opacity-55";
  if (size === "lg") return "size-[18px] shrink-0 text-muted-foreground opacity-55";
  return "size-4 shrink-0 text-muted-foreground opacity-55";
}

/**
 * Unified dropdown control: list selection (`select`) or custom menu panel (`menu`).
 * Same trigger chrome and **sm / md / lg** scale as header pickers — use this instead of
 * wiring `Select`, `DropdownMenu`, and one-off `<select>` separately.
 */
export function AppDropdown(props: AppDropdownProps) {
  const size: DropdownControlSize = props.size ?? "md";

  if (props.mode === "menu") {
    const {
      triggerLabel,
      triggerIcon,
      children,
      className,
      disabled,
      contentClassName,
      align = "start",
    } = props;

    const showIcon = triggerIcon !== null;
    const iconNode =
      triggerIcon === undefined ? (
        <MoreHorizontal className="shrink-0 opacity-80" />
      ) : (
        triggerIcon
      );

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <DropdownControlTrigger size={size} className={cn("min-w-0", className)}>
            <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
              {showIcon ? iconNode : null}
              <span className="min-w-0 truncate">{triggerLabel}</span>
            </span>
            <ChevronDownIcon className={menuChevronClass(size)} />
          </DropdownControlTrigger>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className={contentClassName}>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const {
    value,
    onValueChange,
    options = [],
    contentChildren,
    placeholder,
    className,
    disabled,
    id,
    triggerPrefix,
    valueDisplay,
    contentAlign = "start",
    contentPosition = "popper",
    sideOffset = 4,
    collisionPadding = 8,
    itemClassName,
    contentClassName,
    name,
    required,
  } = props;

  return (
    <Select
      {...(value !== undefined ? { value } : {})}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
      required={required}
    >
      <SelectTrigger size={size} className={cn("min-w-0", className)} id={id}>
        {triggerPrefix != null ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {triggerPrefix}
            <SelectValue placeholder={placeholder}>{valueDisplay}</SelectValue>
          </span>
        ) : (
          <SelectValue placeholder={placeholder}>{valueDisplay}</SelectValue>
        )}
      </SelectTrigger>
      <SelectContent
        className={contentClassName}
        align={contentAlign}
        position={contentPosition}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
      >
        {contentChildren !== undefined
          ? contentChildren
          : options.map((o) => (
              <SelectItem
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={cn(itemClassName, o.itemClassName)}
              >
                {o.label}
              </SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
}

export { SelectItem };
