import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToolStore } from "@/stores/toolStore";
import { SoftphoneRegistrarPicker } from "./SoftphoneRegistrarPicker";

export function SoftphoneHeader() {
  const isActive = useToolStore((s) => s.activeToolId === "soft-phone");

  const [headerPortal, setHeaderPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderPortal(document.getElementById("header-tool-widget-custom"));
  }, []);

  if (!isActive || !headerPortal) return null;

  return createPortal(
    <>
      <SoftphoneRegistrarPicker />
    </>,
    headerPortal,
  );
}
