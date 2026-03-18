import { useToolStore } from "@/stores/toolStore";
import { useRegistrationStore } from "@/stores/registrationStore";

export type NavigationTarget = 
  | { tool: "registration"; view?: "list" | "reports"; registrarId?: string }
  | { tool: string; view?: string; [key: string]: unknown };

export function useNavigation() {
  const setActiveTool = useToolStore((s) => s.setActiveTool);
  const setSelectedRegistrar = useRegistrationStore((s) => s.setSelectedRegistrar);

  const navigate = (target: NavigationTarget) => {
    try {
      // Set the active tool
      setActiveTool(target.tool);

      // Handle registration tool specific navigation
      if (target.tool === "registration") {
        // Use a custom event to communicate with RegistrationToolset
        // Since it uses local state, we'll dispatch an event
        if (target.view) {
          window.dispatchEvent(
            new CustomEvent("navigate-registration-view", {
              detail: { view: target.view, registrarId: target.registrarId },
            })
          );
        }

        // Set selected registrar if provided
        if (target.registrarId && typeof target.registrarId === "string") {
          setSelectedRegistrar(target.registrarId);
        }
      }

      // Handle other tools as needed
      // Future tools can listen for their own navigation events
    } catch (error) {
      console.error("Navigation error:", error);
      throw new Error(`Failed to navigate: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  return { navigate };
}
