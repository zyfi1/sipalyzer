/**
 * Utility functions for extracting and formatting error messages
 */

export function extractErrorMessage(error: unknown): string {
  if (!error) {
    return "An unknown error occurred";
  }

  // Handle string errors
  if (typeof error === "string") {
    return error;
  }

  // Handle Error objects
  if (error instanceof Error) {
    return error.message || error.toString();
  }

  // Handle Tauri errors (often objects with message property)
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;
    
    // Try common error message properties
    if (typeof err.message === "string") {
      return err.message;
    }
    
    if (typeof err.error === "string") {
      return err.error;
    }
    
    if (typeof err.msg === "string") {
      return err.msg;
    }
    
    // Try to stringify the error
    try {
      const stringified = JSON.stringify(error);
      if (stringified !== "{}") {
        return stringified;
      }
    } catch {
      // JSON.stringify failed, continue
    }
    
    // Last resort: toString
    if (err.toString && typeof err.toString === "function") {
      const str = err.toString();
      if (str !== "[object Object]") {
        return str;
      }
    }
  }

  return "An unexpected error occurred. Please check the console for details.";
}

export interface HumanizedError {
  userMessage: string;
  actionHint?: string;
  technicalMessage: string;
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function humanizeErrorMessage(error: unknown): HumanizedError {
  const technicalMessage = normalizeText(extractErrorMessage(error));
  const messageLower = technicalMessage.toLowerCase();

  if (
    messageLower.includes("permission denied") ||
    messageLower.includes("access is denied") ||
    messageLower.includes("operation not permitted")
  ) {
    return {
      userMessage: "Permission was denied while performing this action.",
      actionHint: "Retry with the required system permission or run the app with elevated privileges.",
      technicalMessage,
    };
  }

  if (messageLower.includes("timed out") || messageLower.includes("timeout")) {
    return {
      userMessage: "The operation took too long and timed out.",
      actionHint: "Try again. If this keeps happening, verify network/device availability and reduce workload.",
      technicalMessage,
    };
  }

  if (
    messageLower.includes("failed to fetch") ||
    messageLower.includes("connection refused") ||
    messageLower.includes("network") ||
    messageLower.includes("econnrefused")
  ) {
    return {
      userMessage: "A network connection problem occurred.",
      actionHint: "Check connectivity, VPN/firewall settings, and target host/port, then retry.",
      technicalMessage,
    };
  }

  if (messageLower.includes("outside approved local scopes")) {
    return {
      userMessage: "That file path is not allowed for this action.",
      actionHint: "Use a path inside Home, app data, or temp directories.",
      technicalMessage,
    };
  }

  if (
    messageLower.includes("go toolchain not found") ||
    messageLower.includes("go binary not found")
  ) {
    return {
      userMessage: "The bundled Go toolchain is missing.",
      actionHint: "Run `npm run setup:go-toolchain` and try again.",
      technicalMessage,
    };
  }

  if (messageLower.includes("unsupported target os")) {
    return {
      userMessage: "The selected target OS is not supported.",
      actionHint: "Choose one of the supported OS targets in the generator settings.",
      technicalMessage,
    };
  }

  if (messageLower.includes("ipc response validation failed")) {
    return {
      userMessage: "The app received an unexpected internal response format.",
      actionHint: "Reload the app. If it continues, update both frontend and backend to matching versions.",
      technicalMessage,
    };
  }

  return {
    userMessage: technicalMessage || "An unexpected error occurred.",
    technicalMessage,
  };
}

export function formatHumanizedError(error: unknown): string {
  const humanized = humanizeErrorMessage(error);
  if (!humanized.actionHint) return humanized.userMessage;
  return `${humanized.userMessage}\nAction: ${humanized.actionHint}`;
}

export function logError(context: string, error: unknown): void {
  console.error(`[${context}] Error:`, error);
  
  if (error instanceof Error) {
    console.error(`[${context}] Error stack:`, error.stack);
  }
  
  if (typeof error === "object" && error !== null) {
    console.error(`[${context}] Error details:`, JSON.stringify(error, null, 2));
  }
}
