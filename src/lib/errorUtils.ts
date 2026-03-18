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

export function logError(context: string, error: unknown): void {
  console.error(`[${context}] Error:`, error);
  
  if (error instanceof Error) {
    console.error(`[${context}] Error stack:`, error.stack);
  }
  
  if (typeof error === "object" && error !== null) {
    console.error(`[${context}] Error details:`, JSON.stringify(error, null, 2));
  }
}
