import { useState } from "react";
import { useContactsStore, type Contact } from "@/stores/contactsStore";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Phone,
  Plus,
  User,
  Star,
  Search,
  Trash2,
  Download,
  Zap,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ContactImportModal } from "./ContactImportModal";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

interface ContactsViewProps {
  setTargetInput: (value: string) => void;
}

export function ContactsView({ setTargetInput }: ContactsViewProps) {
  const contacts = useContactsStore((s) => s.contacts);
  const addContact = useContactsStore((s) => s.addContact);
  const deleteContact = useContactsStore((s) => s.deleteContact);
  const toggleFavorite = useContactsStore((s) => s.toggleFavorite);
  const toggleSpeedDial = useContactsStore((s) => s.toggleSpeedDial);

  const [contactSearch, setContactSearch] = useState("");
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactImportOpen, setContactImportOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [newContact, setNewContact] = useState({ name: "", phone: "", company: "" });

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
      c.phone.includes(contactSearch) ||
      (c.company && c.company.toLowerCase().includes(contactSearch.toLowerCase()))
  );
  const favorites = filtered.filter((c) => c.favorite);
  const others = filtered.filter((c) => !c.favorite);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Search & Actions */}
      <div className="surface-subtle px-4 py-3 border-b border-border/20 flex items-center gap-2 shrink-0">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            type="text"
            placeholder="Search contacts..."
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            className="ui-control-shell h-8 w-full pl-8 pr-3 text-sm placeholder:text-muted-foreground/60"
          />
        </div>
        <TooltipWrapper content="Import contacts">
          <button
            type="button"
            onClick={() => setContactImportOpen(true)}
            className="ui-control-shell h-8 w-8 rounded-md flex items-center justify-center transition-smooth"
          >
            <Download className="h-4 w-4 text-muted-foreground" />
          </button>
        </TooltipWrapper>
        <TooltipWrapper content="Add contact">
          <button
            type="button"
            onClick={() => {
              setEditingContact(null);
              setNewContact({ name: "", phone: "", company: "" });
              setContactDialogOpen(true);
            }}
            className="ui-control-shell h-8 w-8 rounded-md flex items-center justify-center transition-smooth"
          >
            <Plus className="h-4 w-4 text-foreground" />
          </button>
        </TooltipWrapper>
      </div>

      {/* Contact List or Empty State */}
      {contacts.length === 0 ? (
        <EmptyState
          compact
          variant="inline"
          icon={<User />}
          title="No contacts yet"
          description="Use the buttons above to import or add contacts."
          className="flex-1 p-6"
        />
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <EmptyState compact variant="inline" title="No matching contacts" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0">
          {favorites.length > 0 && (
            <>
              <div className="px-2 py-1 text-2xs text-muted-foreground/60 uppercase tracking-wider">
                Favorites
              </div>
              {favorites.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onCall={(phone) => setTargetInput(phone)}
                  onFavorite={() => toggleFavorite(contact.id)}
                  onSpeedDial={() => toggleSpeedDial(contact.id)}
                  onDelete={() => deleteContact(contact.id)}
                />
              ))}
            </>
          )}
          {others.length > 0 && (
            <>
              {favorites.length > 0 && (
                <div className="px-2 py-1 text-2xs text-muted-foreground/60 uppercase tracking-wider">
                  All
                </div>
              )}
              {others.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onCall={(phone) => setTargetInput(phone)}
                  onFavorite={() => toggleFavorite(contact.id)}
                  onSpeedDial={() => toggleSpeedDial(contact.id)}
                  onDelete={() => deleteContact(contact.id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Add/Edit Contact Dialog */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {editingContact ? "Edit Contact" : "Add Contact"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="John Smith"
                value={newContact.name}
                onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="+1 555 123 4567"
                value={newContact.phone}
                onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Company</Label>
              <Input
                placeholder="Acme Inc."
                value={newContact.company}
                onChange={(e) => setNewContact({ ...newContact, company: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <TooltipWrapper title="Cancel" description="Close without saving.">
              <Button variant="ghost" onClick={() => setContactDialogOpen(false)}>
                Cancel
              </Button>
            </TooltipWrapper>
            <TooltipWrapper
              title={editingContact ? "Save" : "Add"}
              description={editingContact ? "Save contact changes." : "Add the new contact."}
            >
              <Button
                variant={editingContact ? "primary" : "default"}
                onClick={() => {
                  if (newContact.name && newContact.phone) {
                    addContact({
                      name: newContact.name,
                      phone: newContact.phone,
                      company: newContact.company || undefined,
                    });
                    setContactDialogOpen(false);
                    setNewContact({ name: "", phone: "", company: "" });
                  }
                }}
                disabled={!newContact.name.trim() || !newContact.phone.trim()}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                {editingContact ? "Save" : "Add"}
              </Button>
            </TooltipWrapper>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Import Modal */}
      <ContactImportModal open={contactImportOpen} onOpenChange={setContactImportOpen} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTACT ROW COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
function ContactRow({
  contact,
  onCall,
  onFavorite,
  onSpeedDial,
  onDelete,
}: {
  contact: Contact;
  onCall: (phone: string) => void;
  onFavorite: () => void;
  onSpeedDial: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-muted/30 transition-smooth">
      <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center shrink-0 text-xs font-medium text-foreground">
        {contact.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground truncate text-sm">{contact.name}</span>
          {contact.favorite && <Star className="h-3 w-3 text-warning fill-warning" />}
          {contact.speedDial && <Zap className="h-3 w-3 text-foreground/70" />}
        </div>
        <div className="text-2xs text-muted-foreground/60 truncate">
          {contact.phone}
          {contact.company && ` · ${contact.company}`}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <TooltipWrapper
          title={contact.speedDial ? "Remove from speed dial" : "Add to speed dial"}
          description={contact.speedDial ? "Remove from dialer quick access." : "Show on dialer for one-tap calling."}
        >
          <button
            type="button"
            onClick={onSpeedDial}
            className="ui-control-shell h-8 w-8 rounded-md flex items-center justify-center"
          >
            <Zap
              className={cn(
                "h-3.5 w-3.5",
                contact.speedDial ? "text-foreground" : "text-muted-foreground"
              )}
            />
          </button>
        </TooltipWrapper>
        <TooltipWrapper
          title={contact.favorite ? "Unfavorite" : "Favorite"}
          description={contact.favorite ? "Remove from favorites." : "Add to favorites."}
        >
          <button
            type="button"
            onClick={onFavorite}
            className="ui-control-shell h-8 w-8 rounded-md flex items-center justify-center"
          >
            <Star
              className={cn(
                "h-3.5 w-3.5",
                contact.favorite ? "text-warning fill-warning" : "text-muted-foreground"
              )}
            />
          </button>
        </TooltipWrapper>
        <TooltipWrapper title="Call" description="Place a call to this contact.">
          <button
            type="button"
            onClick={() => onCall(contact.phone)}
            className="ui-control-shell h-8 w-8 rounded-md flex items-center justify-center text-success"
          >
            <Phone className="h-3.5 w-3.5 text-success" />
          </button>
        </TooltipWrapper>
        <TooltipWrapper title="Delete" description="Remove this contact.">
          <button
            type="button"
            onClick={onDelete}
            className="ui-control-shell h-8 w-8 rounded-md flex items-center justify-center"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </TooltipWrapper>
      </div>
    </div>
  );
}
