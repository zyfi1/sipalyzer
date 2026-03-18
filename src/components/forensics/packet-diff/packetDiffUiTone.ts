import type { PacketDiffRowStatus } from "./packetDiffEngine";
import type { PacketFieldDiffStatus } from "./packetFieldDiff";

export function rowStatusToneClasses(status: PacketDiffRowStatus): string {
  switch (status) {
    case "exact":
      return "border-success/22";
    case "changed":
      return "border-warning/24";
    case "left_only":
      return "border-destructive/28";
    case "right_only":
      return "border-success/28";
  }
}

export function rowStatusMarkerClasses(status: PacketDiffRowStatus): string {
  switch (status) {
    case "exact":
      return "bg-success/60";
    case "changed":
      return "bg-warning/70";
    case "left_only":
      return "bg-destructive/68";
    case "right_only":
      return "bg-success/70";
  }
}

export function fieldStatusToneClasses(status: PacketFieldDiffStatus): string {
  switch (status) {
    case "same":
      return "text-muted-foreground";
    case "changed":
      return "text-warning border-warning/40";
    case "left_only":
      return "text-destructive border-destructive/40";
    case "right_only":
      return "text-success border-success/40";
  }
}

