/**
 * Global hook to open captures from anywhere in the application.
 * 
 * Provides methods to:
 * - Open a modal quick view
 * - Open in the dedicated capture viewer tool
 * - Switch the packet monitor to a specific capture
 */

import { create } from "zustand";
import type { CaptureSession } from "@/types/packetCapture";

interface OpenCaptureOptions {
  /** Initial filter expression. */
  filter?: string;
  /** Packet ID to highlight. */
  highlightPacketId?: string;
  /** Default details tab when opening in packet viewer. */
  detailsTab?: "overview" | "protocol" | "raw";
}

interface OpenCaptureState {
  // Modal state
  modalSessionId: string | null;
  modalSession: CaptureSession | null;
  modalOptions: OpenCaptureOptions;
  isModalOpen: boolean;
  
  // Dedicated viewer state
  viewerSessionId: string | null;
  viewerSession: CaptureSession | null;
  viewerOptions: OpenCaptureOptions;
  isViewerRequested: boolean;
  
  // Actions
  openModal: (sessionId: string, session?: CaptureSession, options?: OpenCaptureOptions) => void;
  closeModal: () => void;
  openViewer: (sessionId: string, session?: CaptureSession, options?: OpenCaptureOptions) => void;
  closeViewer: () => void;
  clearViewerRequest: () => void;
}

export const useOpenCaptureStore = create<OpenCaptureState>((set) => ({
  // Modal state
  modalSessionId: null,
  modalSession: null,
  modalOptions: {},
  isModalOpen: false,
  
  // Viewer state
  viewerSessionId: null,
  viewerSession: null,
  viewerOptions: {},
  isViewerRequested: false,
  
  openModal: (sessionId, session, options = {}) => {
    set({
      modalSessionId: sessionId,
      modalSession: session || null,
      modalOptions: options,
      isModalOpen: true,
    });
  },
  
  closeModal: () => {
    set({
      isModalOpen: false,
      // Keep the session data briefly for animations
    });
    // Clear after animation
    setTimeout(() => {
      set({
        modalSessionId: null,
        modalSession: null,
        modalOptions: {},
      });
    }, 300);
  },
  
  openViewer: (sessionId, session, options = {}) => {
    set({
      viewerSessionId: sessionId,
      viewerSession: session || null,
      viewerOptions: options,
      isViewerRequested: true,
    });
  },
  
  closeViewer: () => {
    set({
      viewerSessionId: null,
      viewerSession: null,
      viewerOptions: {},
      isViewerRequested: false,
    });
  },
  
  clearViewerRequest: () => {
    set({ isViewerRequested: false });
  },
}));

/**
 * Hook for opening captures from anywhere in the app.
 * 
 * @example
 * ```tsx
 * const { openModal, openViewer } = useOpenCapture();
 * 
 * // Quick modal view
 * openModal(sessionId, session, { filter: 'sip' });
 * 
 * // Full analysis in dedicated viewer
 * openViewer(sessionId, session);
 * ```
 */
export function useOpenCapture() {
  const openModal = useOpenCaptureStore((s) => s.openModal);
  const closeModal = useOpenCaptureStore((s) => s.closeModal);
  const openViewer = useOpenCaptureStore((s) => s.openViewer);
  const closeViewer = useOpenCaptureStore((s) => s.closeViewer);
  
  return {
    openModal,
    closeModal,
    openViewer,
    closeViewer,
  };
}

/**
 * Hook for the modal state (used by the modal component).
 */
export function useOpenCaptureModal() {
  const sessionId = useOpenCaptureStore((s) => s.modalSessionId);
  const session = useOpenCaptureStore((s) => s.modalSession);
  const options = useOpenCaptureStore((s) => s.modalOptions);
  const isOpen = useOpenCaptureStore((s) => s.isModalOpen);
  const closeModal = useOpenCaptureStore((s) => s.closeModal);
  
  return {
    sessionId,
    session,
    options,
    isOpen,
    close: closeModal,
  };
}

/**
 * Hook for the viewer state (used by the dedicated viewer).
 */
export function useOpenCaptureViewer() {
  const sessionId = useOpenCaptureStore((s) => s.viewerSessionId);
  const session = useOpenCaptureStore((s) => s.viewerSession);
  const options = useOpenCaptureStore((s) => s.viewerOptions);
  const isRequested = useOpenCaptureStore((s) => s.isViewerRequested);
  const closeViewer = useOpenCaptureStore((s) => s.closeViewer);
  const clearRequest = useOpenCaptureStore((s) => s.clearViewerRequest);
  
  return {
    sessionId,
    session,
    options,
    isRequested,
    close: closeViewer,
    clearRequest,
  };
}

export default useOpenCapture;
