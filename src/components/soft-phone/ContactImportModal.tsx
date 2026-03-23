/**
 * Contact Import Modal - Import contacts from CSV, vCard, clipboard, or LDAP
 */

import { useState, useCallback, useRef } from "react";
import { invokeTauri } from "@/api/invoke";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useContactsStore } from "@/stores/contactsStore";
import { fetchUrl } from "@/api/provision";
import {
  parseClipboard,
  parseContactFile,
  type ParseResult,
} from "@/lib/contactParsers";
import {
  Download,
  FileText,
  Clipboard,
  CheckCircle,
  AlertTriangle,
  X,
  Users,
  Loader2,
  Network,
  FileSearch,
  Check,
  Plus,
  Globe,
  Link2,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useToolStore } from "@/stores/toolStore";
import { Switch } from "@/components/ui/switch";
import {
  parseContactsFile,
  hasRealPhoneNumber,
  getBestPhone,
  parsedContactToImport,
} from "@/lib/provisionContactUtils";

interface ContactImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ImportStep = "select" | "preview" | "result";
type TabType = "file" | "clipboard" | "ldap" | "provision";

interface ImportedContact {
  name: string;
  phone: string;
  email?: string;
  company?: string;
  notes?: string;
}

export function ContactImportModal({ open, onOpenChange }: ContactImportModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("file");
  const [step, setStep] = useState<ImportStep>("select");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [importCount, setImportCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [clipboardText, setClipboardText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // LDAP state
  const [ldapConfig, setLdapConfig] = useState({
    serverUrl: "",
    baseDn: "",
    bindDn: "",
    bindPassword: "",
    searchFilter: "(objectClass=person)",
    useTls: true,
  });

  // URL fetch state
  const [phonebookUrl, setPhonebookUrl] = useState("");
  const [fetchingPhonebook, setFetchingPhonebook] = useState(false);
  const [urlFetchError, setUrlFetchError] = useState<string | null>(null);
  const [urlFetchSuccess, setUrlFetchSuccess] = useState<string | null>(null);

  // Provision tab state
  const [provIncludeExt, setProvIncludeExt] = useState(false);
  const [provDeselected, setProvDeselected] = useState<Set<number>>(new Set());
  const contactsFileContent = useToolStore((s) => s.provisionViewerData.contactsFileContent);
  const provisionParsed = contactsFileContent ? parseContactsFile(contactsFileContent) : [];

  const importContacts = useContactsStore((s) => s.importContacts);

  const resetState = useCallback(() => {
    setStep("select");
    setParseResult(null);
    setImportCount(0);
    setClipboardText("");
    setFileName(null);
    setDragOver(false);
    setLoading(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setTimeout(resetState, 200);
  }, [onOpenChange, resetState]);

  const handleFileSelect = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) return;

      const result = parseContactFile(content, file.name);
      setParseResult(result);
      setFileName(file.name);
      setStep("preview");
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setParseResult({
          contacts: [],
          errors: ["Clipboard is empty"],
          warnings: [],
        });
        return;
      }
      setClipboardText(text);
      const result = parseClipboard(text);
      setParseResult(result);
      setStep("preview");
    } catch {
      setParseResult({
        contacts: [],
        errors: ["Failed to read clipboard. Please paste text manually."],
        warnings: [],
      });
    }
  }, []);

  const handleTextAreaPaste = useCallback((text: string) => {
    setClipboardText(text);
    if (text.trim()) {
      const result = parseClipboard(text);
      setParseResult(result);
      setStep("preview");
    }
  }, []);

  const handleImport = useCallback(() => {
    if (!parseResult || parseResult.contacts.length === 0) return;
    const count = importContacts(parseResult.contacts);
    setImportCount(count);
    setStep("result");
  }, [parseResult, importContacts]);

  const handleBack = useCallback(() => {
    setStep("select");
    setParseResult(null);
    setFileName(null);
    setError(null);
  }, []);

  // Provision handler
  const handleProvisionImport = useCallback(() => {
    const toImport = provisionParsed
      .filter((_, i) => !provDeselected.has(i))
      .map((c) => parsedContactToImport(c, provIncludeExt))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    if (toImport.length === 0) {
      setImportCount(0);
      setStep("result");
      return;
    }
    const count = importContacts(toImport);
    setImportCount(count);
    setStep("result");
  }, [provisionParsed, provDeselected, provIncludeExt, importContacts]);

  const toggleProvContact = useCallback((idx: number) => {
    setProvDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleProvSelectAll = useCallback(() => {
    if (provDeselected.size === 0) {
      // Deselect all
      setProvDeselected(new Set(provisionParsed.map((_, i) => i)));
    } else {
      // Select all
      setProvDeselected(new Set());
    }
  }, [provisionParsed.length, provDeselected]);

  // URL fetch handler
  const handleFetchPhonebook = useCallback(async () => {
    const url = phonebookUrl.trim();
    if (!url) return;
    setFetchingPhonebook(true);
    setUrlFetchError(null);
    setUrlFetchSuccess(null);
    try {
      const content = await fetchUrl(url);
      const parsed = parseContactsFile(content);
      if (parsed.length === 0) {
        setUrlFetchError("No contacts found in the response. Ensure the URL points to a valid XML or CSV phonebook.");
        return;
      }
      const toImport = parsed
        .map((c) => parsedContactToImport(c, true))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (toImport.length === 0) {
        setUrlFetchError("Contacts were parsed but none had usable phone numbers.");
        return;
      }
      const count = importContacts(toImport);
      setUrlFetchSuccess(
        count > 0
          ? `Imported ${count} contact${count !== 1 ? "s" : ""} from phonebook.`
          : `All ${toImport.length} contacts already exist.`
      );
    } catch (err) {
      setUrlFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingPhonebook(false);
    }
  }, [phonebookUrl, importContacts]);

  // LDAP handlers
  const handleLdapTest = useCallback(async () => {
    if (!ldapConfig.serverUrl || !ldapConfig.baseDn) {
      setError("Please enter server URL and Base DN");
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await invokeTauri<string>("ldap_test_connection", {
        config: {
          server_url: ldapConfig.serverUrl,
          base_dn: ldapConfig.baseDn,
          bind_dn: ldapConfig.bindDn || null,
          bind_password: ldapConfig.bindPassword || null,
          search_filter: ldapConfig.searchFilter || null,
          use_tls: ldapConfig.useTls,
        },
      });
      setError(null);
      alert(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ldapConfig]);

  const handleLdapFetch = useCallback(async () => {
    if (!ldapConfig.serverUrl || !ldapConfig.baseDn) {
      setError("Please enter server URL and Base DN");
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const contacts = await invokeTauri<ImportedContact[]>("ldap_fetch_contacts", {
        config: {
          server_url: ldapConfig.serverUrl,
          base_dn: ldapConfig.baseDn,
          bind_dn: ldapConfig.bindDn || null,
          bind_password: ldapConfig.bindPassword || null,
          search_filter: ldapConfig.searchFilter || null,
          use_tls: ldapConfig.useTls,
        },
      });
      
      setParseResult({
        contacts,
        errors: [],
        warnings: [],
      });
      setFileName("LDAP Directory");
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ldapConfig]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[calc(min(100vh,100dvh)-2rem)] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Import Contacts
          </DialogTitle>
          <DialogDescription>
            {step === "select" && "Choose an import source"}
            {step === "preview" && "Review contacts before importing"}
            {step === "result" && "Import complete"}
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="flex-1">
            <TabsList className="subview-tabs-compact w-full">
              <TabsTrigger value="file" className="subview-tab-compact flex-1">
                <FileText className="h-3.5 w-3.5" />
                File
              </TabsTrigger>
              <TabsTrigger value="clipboard" className="subview-tab-compact flex-1">
                <Clipboard className="h-3.5 w-3.5" />
                Clipboard
              </TabsTrigger>
              <TabsTrigger value="ldap" className="subview-tab-compact flex-1">
                <Network className="h-3.5 w-3.5" />
                LDAP
              </TabsTrigger>
              <TabsTrigger value="provision" className="subview-tab-compact flex-1">
                <FileSearch className="h-3.5 w-3.5" />
                Provision
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="mt-4">
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-smooth",
                  dragOver
                    ? "border-foreground/30 bg-muted/20"
                    : "border-border hover:border-muted-foreground/50"
                )}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <Download className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop a file here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Supports CSV and vCard (.vcf) files
                </p>
                <Button variant="neutral" onClick={() => fileInputRef.current?.click()}>
                  Choose File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.vcf,.vcard,text/csv,text/vcard"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </div>
            </TabsContent>

            <TabsContent value="clipboard" className="mt-4">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Copy contacts from a spreadsheet and paste here.
                </p>
                <TooltipWrapper title="Paste from Clipboard" description="Read contacts from the clipboard.">
                  <Button onClick={handlePasteFromClipboard} className="w-full gap-2">
                    <Clipboard className="h-4 w-4" />
                    Paste from Clipboard
                  </Button>
                </TooltipWrapper>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or paste manually</span>
                  </div>
                </div>
                <textarea
                  placeholder="Paste tab-separated data here..."
                  className="w-full h-32 p-3 text-sm border rounded-lg bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  value={clipboardText}
                  onChange={(e) => setClipboardText(e.target.value)}
                  onPaste={(e) => {
                    e.preventDefault();
                    handleTextAreaPaste(e.clipboardData.getData("text"));
                  }}
                />
                {clipboardText && (
                  <Button onClick={() => handleTextAreaPaste(clipboardText)} className="w-full">
                    Parse Pasted Data
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="ldap" className="mt-4">
              <div className="space-y-4">
                <div className="p-4 bg-muted/50 rounded-lg text-sm space-y-2">
                  <p className="font-medium">LDAP/Active Directory</p>
                  <p className="text-muted-foreground text-xs">
                    Connect to an LDAP directory or Active Directory to import contacts.
                  </p>
                </div>
                <div className="grid gap-3">
                  <div className="space-y-1.5">
                    <Label>Server URL</Label>
                    <Input
                      placeholder="ldap://ldap.example.com or ldaps://..."
                      value={ldapConfig.serverUrl}
                      onChange={(e) => setLdapConfig((c) => ({ ...c, serverUrl: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Base DN</Label>
                    <Input
                      placeholder="dc=example,dc=com"
                      value={ldapConfig.baseDn}
                      onChange={(e) => setLdapConfig((c) => ({ ...c, baseDn: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Bind DN (optional)</Label>
                      <Input
                        placeholder="cn=admin,dc=example,dc=com"
                        value={ldapConfig.bindDn}
                        onChange={(e) => setLdapConfig((c) => ({ ...c, bindDn: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Bind Password</Label>
                      <Input
                        type="password"
                        placeholder="Password"
                        value={ldapConfig.bindPassword}
                        onChange={(e) => setLdapConfig((c) => ({ ...c, bindPassword: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Search Filter</Label>
                    <Input
                      placeholder="(objectClass=person)"
                      value={ldapConfig.searchFilter}
                      onChange={(e) => setLdapConfig((c) => ({ ...c, searchFilter: e.target.value }))}
                    />
                  </div>
                </div>
                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-2">
                    {error}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="neutral" onClick={handleLdapTest} disabled={loading} className="flex-1 gap-2">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Test Connection
                  </Button>
                  <Button onClick={handleLdapFetch} disabled={loading} className="flex-1 gap-2">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
                    {loading ? "Fetching..." : "Fetch Contacts"}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="provision" className="mt-4">
              <div className="space-y-4">
                {/* ── Fetch from URL ── */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground/70">Fetch from URL</Label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                      <Input
                        placeholder="https://provisioning.example.com/phonebook.xml"
                        value={phonebookUrl}
                        onChange={(e) => { setPhonebookUrl(e.target.value); setUrlFetchError(null); setUrlFetchSuccess(null); }}
                        onKeyDown={(e) => e.key === "Enter" && handleFetchPhonebook()}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleFetchPhonebook}
                      disabled={!phonebookUrl.trim() || fetchingPhonebook}
                      className="gap-1.5 h-8 shrink-0"
                    >
                      {fetchingPhonebook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                      {fetchingPhonebook ? "Fetching..." : "Fetch"}
                    </Button>
                  </div>
                  {urlFetchError && (
                    <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-2">
                      <X className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {urlFetchError}
                    </div>
                  )}
                  {urlFetchSuccess && (
                    <div className="flex items-start gap-2 text-xs text-success bg-success/10 rounded-lg p-2">
                      <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {urlFetchSuccess}
                    </div>
                  )}
                </div>

                {/* ── Provision file contacts ── */}
                {provisionParsed.length > 0 ? (
                  <>
                    <div className="border-t border-border/30" />

                    {/* Controls */}
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary">
                        {provisionParsed.length} contact{provisionParsed.length !== 1 ? "s" : ""} from provision
                      </Badge>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <TooltipWrapper title="Include extensions" description="Import extension numbers as phone numbers when available.">
                            <div className="flex items-center gap-2">
                              <Label htmlFor="prov-ext" className="section-label-sm cursor-pointer whitespace-nowrap">
                                Include extensions
                              </Label>
                              <Switch
                                id="prov-ext"
                                checked={provIncludeExt}
                                onCheckedChange={setProvIncludeExt}
                              />
                            </div>
                          </TooltipWrapper>
                        </div>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="max-h-[240px] overflow-y-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="surface-subtle sticky top-0">
                          <tr>
                            <th className="w-8 p-2">
                              <button
                                type="button"
                                onClick={toggleProvSelectAll}
                                className={cn(
                                  "w-4 h-4 rounded border flex items-center justify-center transition-smooth",
                                  provDeselected.size === 0
                                    ? "bg-accent border-foreground/30 text-foreground"
                                    : "border-muted-foreground/40 hover:border-foreground/30"
                                )}
                              >
                                {provDeselected.size === 0 && <Check className="h-3 w-3" />}
                              </button>
                            </th>
                            <th className="text-left p-2 font-medium">Name</th>
                            <th className="text-left p-2 font-medium">Phone</th>
                            <th className="text-left p-2 font-medium">Mobile</th>
                            <th className="text-left p-2 font-medium">Other</th>
                          </tr>
                        </thead>
                        <tbody>
                          {provisionParsed.map((c, i) => {
                            const hasReal = hasRealPhoneNumber(c);
                            const bestPhone = getBestPhone(c, provIncludeExt);
                            const isUsable = bestPhone !== null;
                            const isSelected = !provDeselected.has(i);
                            const dimmed = !provIncludeExt && !hasReal;

                            return (
                              <tr
                                key={i}
                                className={cn(
                                  "border-t cursor-pointer hover:bg-muted/30 transition-smooth",
                                  dimmed && "opacity-40",
                                  !isUsable && "opacity-30 pointer-events-none"
                                )}
                                onClick={() => isUsable && toggleProvContact(i)}
                              >
                                <td className="p-2">
                                  {isUsable && (
                                    <div className={cn(
                                      "w-4 h-4 rounded border flex items-center justify-center transition-smooth",
                                      isSelected
                                        ? "bg-accent border-foreground/30 text-foreground"
                                        : "border-muted-foreground/40"
                                    )}>
                                      {isSelected && <Check className="h-3 w-3" />}
                                    </div>
                                  )}
                                </td>
                                <td className="p-2 truncate max-w-[130px]">{c.displayName}</td>
                                <td className="p-2 font-mono text-xs text-muted-foreground">{c.office ?? "—"}</td>
                                <td className="p-2 font-mono text-xs text-muted-foreground">{c.mobile ?? "—"}</td>
                                <td className="p-2 font-mono text-xs text-muted-foreground">{c.other ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Import button */}
                    <DialogFooter>
                      <Button
                        onClick={handleProvisionImport}
                        disabled={provisionParsed.length === 0}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Import {provisionParsed.filter((_, i) => !provDeselected.has(i)).filter((c) => getBestPhone(c, provIncludeExt) !== null).length} Contact{provisionParsed.filter((_, i) => !provDeselected.has(i)).filter((c) => getBestPhone(c, provIncludeExt) !== null).length !== 1 ? "s" : ""}
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <div className="border-t border-border/30" />
                    <div className="py-4 text-center">
                      <p className="text-xs text-muted-foreground">
                        Load a provision file in the Provision Viewer to detect device contacts here, or fetch from a URL above.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {step === "preview" && parseResult && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-4 mb-4">
              {fileName && (
                <Badge variant="secondary" className="gap-1">
                  <FileText className="h-3 w-3" />
                  {fileName}
                </Badge>
              )}
              <Badge variant="secondary">
                {parseResult.contacts.length} contact{parseResult.contacts.length !== 1 ? "s" : ""} found
              </Badge>
            </div>

            {(parseResult.errors.length > 0 || parseResult.warnings.length > 0) && (
              <div className="mb-4 space-y-2">
                {parseResult.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-2">
                    <X className="h-4 w-4 shrink-0 mt-0.5" />
                    {err}
                  </div>
                ))}
                {parseResult.warnings.slice(0, 3).map((warn, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-warning dark:text-warning bg-warning/10 rounded-lg p-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    {warn}
                  </div>
                ))}
                {parseResult.warnings.length > 3 && (
                  <p className="text-xs text-muted-foreground">
                    +{parseResult.warnings.length - 3} more warnings
                  </p>
                )}
              </div>
            )}

            {parseResult.contacts.length > 0 && (
              <div className="flex-1 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="surface-subtle sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-left p-2 font-medium">Phone</th>
                      <th className="text-left p-2 font-medium">Email</th>
                      <th className="text-left p-2 font-medium">Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.contacts.slice(0, 50).map((contact, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 truncate max-w-[150px]">{contact.name}</td>
                        <td className="p-2 font-mono text-xs">{contact.phone}</td>
                        <td className="p-2 truncate max-w-[150px] text-muted-foreground">
                          {contact.email || "—"}
                        </td>
                        <td className="p-2 truncate max-w-[120px] text-muted-foreground">
                          {contact.company || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parseResult.contacts.length > 50 && (
                  <p className="text-xs text-muted-foreground p-2 text-center border-t">
                    Showing first 50 of {parseResult.contacts.length} contacts
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="mt-4">
              <Button variant="neutral" onClick={handleBack}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={parseResult.contacts.length === 0}
                className="gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                Import {parseResult.contacts.length} Contact{parseResult.contacts.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "result" && (
          <div className="py-8 text-center">
            <CheckCircle className="h-16 w-16 mx-auto text-success mb-4" />
            <h3 className="text-lg font-semibold mb-2">Import Complete</h3>
            <p className="text-muted-foreground mb-6">
              {importCount > 0 ? (
                <>
                  Successfully imported <span className="font-semibold text-foreground">{importCount}</span>{" "}
                  new contact{importCount !== 1 ? "s" : ""}.
                </>
              ) : (
                "No new contacts were imported (all contacts already exist)."
              )}
            </p>
            <DialogFooter className="justify-center">
              <TooltipWrapper title="Done" description="Close the import dialog.">
                <Button onClick={handleClose}>Done</Button>
              </TooltipWrapper>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
