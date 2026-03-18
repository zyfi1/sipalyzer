import { Fragment } from "react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CREATABLE_PROTOCOLS, getProtocolMeta, type ComposerCreatableProtocol } from "./protocolMeta";

type ComposerCreateMenuItemsProps = {
  onCreate: (protocol: ComposerCreatableProtocol) => void;
};

export function ComposerCreateMenuItems({ onCreate }: ComposerCreateMenuItemsProps) {
  return (
    <>
      {CREATABLE_PROTOCOLS.map((protocol, index) => {
        const meta = getProtocolMeta(protocol);
        const ProtocolIcon = meta.icon;
        return (
          <Fragment key={protocol}>
            {index === 2 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onCreate(protocol)}>
              <ProtocolIcon className={cn("h-3.5 w-3.5 mr-2", meta.colorClass)} />
              {meta.requestLabel}
            </DropdownMenuItem>
          </Fragment>
        );
      })}
    </>
  );
}
