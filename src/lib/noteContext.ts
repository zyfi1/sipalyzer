/**
 * Generic note context for linking notes to various entities.
 * This provides a unified interface for linking notes to registrars, domains,
 * contacts, or any custom entity in the future.
 */
export interface NoteContext {
  /** The type of entity this note is linked to */
  type: "registrar" | "domain" | "contact" | "agent" | "custom";
  /** The unique ID of the entity */
  id: string;
  /** Display name for the entity (for UI) */
  displayName: string;
}

/**
 * Create a note context for a registrar
 */
export function createRegistrarContext(id: string, name: string): NoteContext {
  return {
    type: "registrar",
    id,
    displayName: name,
  };
}

/**
 * Create a note context for a domain
 */
export function createDomainContext(id: string, domainName: string): NoteContext {
  return {
    type: "domain",
    id,
    displayName: domainName,
  };
}

/**
 * Create a note context for a contact
 */
export function createContactContext(id: string, contactName: string): NoteContext {
  return {
    type: "contact",
    id,
    displayName: contactName,
  };
}

/**
 * Create a note context for a remote agent
 */
export function createAgentContext(id: string, displayName: string): NoteContext {
  return {
    type: "agent",
    id,
    displayName,
  };
}

/**
 * Create a custom note context
 */
export function createCustomContext(id: string, displayName: string): NoteContext {
  return {
    type: "custom",
    id,
    displayName,
  };
}

/**
 * Get the linked entity field name for a context type
 * (Used for backward compatibility with existing linkedRegistrarId)
 */
export function getLinkedFieldName(contextType: NoteContext["type"]): string | null {
  switch (contextType) {
    case "registrar":
      return "linkedRegistrarId";
    case "agent":
      return "linkedAgentId";
    case "domain":
      return "linkedDomainId";
    case "contact":
      return "linkedContactId";
    case "custom":
      return null;
    default:
      return null;
  }
}
