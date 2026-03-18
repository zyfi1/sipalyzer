/**
 * Backend API contracts — documented shapes for key Tauri commands.
 * Used by the API layer and stores; extend when adding new commands.
 *
 * Key commands:
 * - get_registration_health → RegistrationHealthResponse (see @/types/forensics)
 * - get_rtp_streams, get_sip_dialogs → see @/types/packetCapture
 *
 * When adding a new Tauri command: add a typed wrapper in the appropriate
 * api/*.ts file, use types from types/ or define here, then call from store or component.
 */

export type {
  RegistrationHealthResponse,
  RegistrarHealth,
  RegistrationMetrics,
} from "@/types/forensics";
