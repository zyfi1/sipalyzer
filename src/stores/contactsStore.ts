/**
 * Contacts store for softphone
 */

import { create } from "zustand";
import { nanoid } from "nanoid";

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  notes?: string;
  favorite?: boolean;
  /** Show on the dialer as a quick-dial button. */
  speedDial?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ContactsState {
  contacts: Contact[];
  addContact: (contact: Omit<Contact, "id" | "createdAt" | "updatedAt">) => Contact;
  updateContact: (id: string, updates: Partial<Omit<Contact, "id" | "createdAt" | "updatedAt">>) => void;
  deleteContact: (id: string) => void;
  toggleFavorite: (id: string) => void;
  toggleSpeedDial: (id: string) => void;
  importContacts: (contacts: Array<{ name: string; phone: string; email?: string; company?: string }>) => number;
  clearContacts: () => void;
}

export const useContactsStore = create<ContactsState>()((set, get) => ({
      contacts: [],

      addContact: (contactData) => {
        const now = new Date().toISOString();
        const newContact: Contact = {
          id: nanoid(),
          ...contactData,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          contacts: [newContact, ...state.contacts],
        }));
        return newContact;
      },

      updateContact: (id, updates) => {
        set((state) => ({
          contacts: state.contacts.map((c) =>
            c.id === id
              ? { ...c, ...updates, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
      },

      deleteContact: (id) => {
        set((state) => ({
          contacts: state.contacts.filter((c) => c.id !== id),
        }));
      },

      toggleFavorite: (id) => {
        set((state) => ({
          contacts: state.contacts.map((c) =>
            c.id === id
              ? { ...c, favorite: !c.favorite, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
      },

      toggleSpeedDial: (id) => {
        set((state) => ({
          contacts: state.contacts.map((c) =>
            c.id === id
              ? { ...c, speedDial: !c.speedDial, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
      },

      importContacts: (importData) => {
        const now = new Date().toISOString();
        const existing = get().contacts;
        const existingPhones = new Set(existing.map((c) => c.phone.replace(/\D/g, "")));
        
        const newContacts: Contact[] = importData
          .filter((c) => c.name && c.phone)
          .filter((c) => !existingPhones.has(c.phone.replace(/\D/g, "")))
          .map((c) => ({
            id: nanoid(),
            name: c.name,
            phone: c.phone,
            email: c.email,
            company: c.company,
            createdAt: now,
            updatedAt: now,
          }));

        if (newContacts.length > 0) {
          set((state) => ({
            contacts: [...newContacts, ...state.contacts],
          }));
        }

        return newContacts.length;
      },

      clearContacts: () => {
        set({ contacts: [] });
      },
}));
