import { cn } from "@/lib/utils";
import { Loader2, Tick } from "@/lib/icons";
import { isSubmenu, type ContextMenuEntry, type ContextMenuItemAction, type ContextMenuSection, type ContextMenuSubmenu } from "@/types/contextMenu";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { trackContextMenuAction } from "@/lib/contextMenuTelemetry";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

interface ContextMenuRendererProps {
  sections: ContextMenuSection[];
  onAction: () => void;
  edgePadding?: number;
}

function ActionItem({ entry, onAction }: { entry: ContextMenuItemAction; onAction: () => void }) {
  return (
    <DropdownMenuItem
      disabled={entry.disabled || entry.loading}
      variant={entry.destructive ? "destructive" : "default"}
      onSelect={() => {
        trackContextMenuAction({
          context: useContextMenuStore.getState().context,
          actionId: entry.id,
          actionLabel: entry.label,
          disabled: !!entry.disabled,
        });
        entry.onClick();
        onAction();
      }}
      className={cn(entry.active && "text-accent-foreground")}
    >
      {entry.icon && (
        <entry.icon
          className={cn(
            "size-4 shrink-0",
            entry.destructive ? "text-destructive" : "text-muted-foreground",
          )}
        />
      )}
      <span className="flex-1 truncate">{entry.label}</span>
      {entry.loading && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>Loading</span>
        </span>
      )}
      {!entry.loading && entry.active && (
        <Tick className="ml-auto size-3.5 shrink-0 text-accent-foreground" />
      )}
      {!entry.loading && !entry.active && entry.disabled && entry.disabledReason && (
        <DropdownMenuShortcut className="text-muted-foreground/70">
          {entry.disabledReason}
        </DropdownMenuShortcut>
      )}
      {!entry.loading && !entry.active && (!entry.disabled || !entry.disabledReason) && entry.shortcut && (
        <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}

function SubmenuItem({
  entry,
  edgePadding = 8,
  onAction,
}: {
  entry: ContextMenuSubmenu;
  edgePadding?: number;
  onAction: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={entry.disabled}>
        {entry.icon && <entry.icon className="size-4 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate">{entry.label}</span>
        {entry.disabled && entry.disabledReason && (
          <DropdownMenuShortcut className="text-muted-foreground/70">
            {entry.disabledReason}
          </DropdownMenuShortcut>
        )}
        {!entry.disabled && entry.shortcut && (
          <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56 max-h-[480px]" collisionPadding={edgePadding}>
        {entry.children.map((child) => (
          <EntryRenderer key={child.id} entry={child} edgePadding={edgePadding} onAction={onAction} />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function EntryRenderer({
  entry,
  edgePadding,
  onAction,
}: {
  entry: ContextMenuEntry;
  edgePadding?: number;
  onAction: () => void;
}) {
  if (isSubmenu(entry)) {
    return <SubmenuItem entry={entry} edgePadding={edgePadding} onAction={onAction} />;
  }

  return <ActionItem entry={entry} onAction={onAction} />;
}

export function ContextMenuRenderer({
  sections,
  onAction,
  edgePadding = 8,
}: ContextMenuRendererProps) {
  return (
    <>
      {sections.map((section, i) => (
        <div key={section.id}>
          {i > 0 && <DropdownMenuSeparator />}
          {section.label && (
            <DropdownMenuLabel className="px-2 py-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 select-none">
              {section.label}
            </DropdownMenuLabel>
          )}
          {section.entries.map((entry) => (
            <EntryRenderer key={entry.id} entry={entry} edgePadding={edgePadding} onAction={onAction} />
          ))}
        </div>
      ))}
    </>
  );
}
