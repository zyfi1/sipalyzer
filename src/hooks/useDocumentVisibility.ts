import { useEffect, useState } from "react";

function isDocumentCurrentlyVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

export function useDocumentVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => isDocumentCurrentlyVisible());

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsVisible(isDocumentCurrentlyVisible());
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return isVisible;
}
