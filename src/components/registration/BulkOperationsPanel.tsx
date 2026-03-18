import { useState, useMemo } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Play,
  CheckCircle2,
  XCircle,
  Download,
  Users,
  TestTube,
  LinkConnect,
  LinkDisconnect,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Network,
  Settings2,
  Phone,
  Printer,
} from "@/lib/icons";
import type { TestType } from "@/types/registration";
import { TEST_TYPES } from "@/types/registration";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { ReportExportDialog } from "./ReportExportDialog";
import { EmptyState } from "@/components/ui/empty-state";

const TEST_CATEGORIES = {
  basic: { label: "Registration", icon: Settings2 },
  network: { label: "Network", icon: Network },
} as const;

const REGISTRAR_CATEGORIES = {
  calling: { label: "Calling", icon: Phone },
  faxing: { label: "Faxing", icon: Printer },
  unassigned: { label: "Unassigned", icon: Users },
} as const;

export function BulkOperationsPanel() {
  const registrars = useRegistrationStore((s) => s.registrars);
  const bulkTestRegistrars = useRegistrationStore((s) => s.bulkTestRegistrars);
  const bulkRegister = useRegistrationStore((s) => s.bulkRegister);
  const bulkUnregister = useRegistrationStore((s) => s.bulkUnregister);
  const bulkOperationInProgress = useRegistrationStore((s) => s.bulkOperationInProgress);
  const bulkResults = useRegistrationStore((s) => s.bulkResults);
  const { error: notifyError, success: notifySuccess } = useNotifications();
  const [selectedRegistrarIds, setSelectedRegistrarIds] = useState<Set<string>>(new Set());
  const [selectedTestTypes, setSelectedTestTypes] = useState<Set<TestType>>(
    new Set(["basic_registration"])
  );
  const [operationType, setOperationType] = useState<"test" | "register" | "unregister" | null>(
    null
  );
  const [isRunning, setIsRunning] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [resultsExpanded, setResultsExpanded] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedRegistrarCategories, setCollapsedRegistrarCategories] = useState<Set<string>>(new Set());

  const registrarNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const reg of registrars) {
      if (!reg.id) continue;
      map.set(reg.id, reg.name || "Unnamed registrar");
    }
    return map;
  }, [registrars]);

  // Group tests by category
  const testsByCategory = useMemo(() => {
    const grouped: Record<string, typeof TEST_TYPES> = { basic: [], network: [] };
    TEST_TYPES.forEach((test) => {
      const category = grouped[test.category];
      if (category) {
        category.push(test);
      }
    });
    return grouped;
  }, []);

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const toggleCategoryTests = (category: string, select: boolean) => {
    const categoryTests = testsByCategory[category] || [];
    const newSelection = new Set(selectedTestTypes);
    categoryTests.forEach((test) => {
      if (select) {
        newSelection.add(test.id);
      } else {
        newSelection.delete(test.id);
      }
    });
    setSelectedTestTypes(newSelection);
  };

  const getCategorySelectedCount = (category: string) => {
    const categoryTests = testsByCategory[category] || [];
    return categoryTests.filter((t) => selectedTestTypes.has(t.id)).length;
  };

  // Group registrars by use_case (comma-separated, so one registrar can appear in multiple groups)
  const registrarsByCategory = useMemo(() => {
    const grouped: Record<string, typeof registrars> = { calling: [], faxing: [], unassigned: [] };
    registrars.forEach((reg) => {
      const cases = reg.use_case?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      if (cases.length === 0) {
        grouped.unassigned!.push(reg);
      } else {
        let placed = false;
        for (const uc of cases) {
          if (grouped[uc]) {
            grouped[uc]!.push(reg);
            placed = true;
          }
        }
        if (!placed) grouped.unassigned!.push(reg);
      }
    });
    return grouped;
  }, [registrars]);

  const toggleRegistrarCategory = (category: string) => {
    setCollapsedRegistrarCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const toggleRegistrarCategorySelection = (category: string, select: boolean) => {
    const categoryRegs = registrarsByCategory[category] || [];
    const newSelection = new Set(selectedRegistrarIds);
    categoryRegs.forEach((reg) => {
      if (reg.id) {
        if (select) {
          newSelection.add(reg.id);
        } else {
          newSelection.delete(reg.id);
        }
      }
    });
    setSelectedRegistrarIds(newSelection);
  };

  const getRegistrarCategorySelectedCount = (category: string) => {
    const categoryRegs = registrarsByCategory[category] || [];
    return categoryRegs.filter((r) => r.id && selectedRegistrarIds.has(r.id)).length;
  };

  const toggleRegistrar = (id: string) => {
    const newSelection = new Set(selectedRegistrarIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedRegistrarIds(newSelection);
  };

  const handleBulkTest = async () => {
    if (selectedRegistrarIds.size === 0) {
      notifyError("No Registrars Selected", "Please select at least one registrar.", { source: "registration" });
      return;
    }
    if (selectedTestTypes.size === 0) {
      notifyError("No Tests Selected", "Please select at least one test type.", { source: "registration" });
      return;
    }

    setOperationType("test");
    setIsRunning(true);
    try {
      const ids = Array.from(selectedRegistrarIds);
      const testTypes = Array.from(selectedTestTypes);
      const results = await bulkTestRegistrars(ids, testTypes);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (failCount === 0) {
        notifySuccess("Bulk Test Completed", `All ${successCount} registrars passed.`, {
          navigation: { tool: "registration", view: "reports" },
          source: "registration",
        });
      } else {
        notifyError(
          "Bulk Test Completed",
          `${successCount} passed, ${failCount} failed.`,
          {
            navigation: { tool: "registration", view: "reports" },
            source: "registration",
          }
        );
      }
    } catch (error) {
      console.error("Bulk test error:", error);
      notifyError(
        "Bulk Test Failed",
        error instanceof Error ? error.message : "Unknown error occurred",
        {
          navigation: { tool: "registration", view: "bulk" },
          source: "registration",
        }
      );
    } finally {
      setOperationType(null);
      setIsRunning(false);
    }
  };

  const handleBulkRegister = async () => {
    if (selectedRegistrarIds.size === 0) {
      notifyError("No Registrars Selected", "Please select at least one registrar.", { source: "registration" });
      return;
    }

    setOperationType("register");
    setIsRunning(true);
    try {
      const ids = Array.from(selectedRegistrarIds);
      const results = await bulkRegister(ids);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (failCount === 0) {
        notifySuccess("Bulk Register Completed", `All ${successCount} registrars registered.`, { source: "registration" });
      } else {
        notifyError(
          "Bulk Register Completed",
          `${successCount} registered, ${failCount} failed.`,
          { source: "registration" }
        );
      }
    } catch (error) {
      console.error("Bulk register error:", error);
      notifyError(
        "Bulk Register Failed",
        error instanceof Error ? error.message : "Unknown error occurred",
        {
          navigation: { tool: "registration", view: "bulk" },
          source: "registration",
        }
      );
    } finally {
      setOperationType(null);
      setIsRunning(false);
    }
  };

  const handleBulkUnregister = async () => {
    if (selectedRegistrarIds.size === 0) {
      notifyError("No Registrars Selected", "Please select at least one registrar.", { source: "registration" });
      return;
    }

    setOperationType("unregister");
    setIsRunning(true);
    try {
      const ids = Array.from(selectedRegistrarIds);
      const results = await bulkUnregister(ids);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (failCount === 0) {
        notifySuccess("Bulk Unregister Completed", `All ${successCount} registrars unregistered.`, { source: "registration" });
      } else {
        notifyError(
          "Bulk Unregister Completed",
          `${successCount} unregistered, ${failCount} failed.`,
          { source: "registration" }
        );
      }
    } catch (error) {
      console.error("Bulk unregister error:", error);
      notifyError(
        "Bulk Unregister Failed",
        error instanceof Error ? error.message : "Unknown error occurred",
        {
          navigation: { tool: "registration", view: "bulk" },
          source: "registration",
        }
      );
    } finally {
      setOperationType(null);
      setIsRunning(false);
    }
  };

  const handleExport = () => {
    if (selectedRegistrarIds.size === 0 && bulkResults.length === 0) {
      notifyError("Nothing to Export", "Please run tests first or select registrars to export.", { source: "registration" });
      return;
    }
    setExportDialogOpen(true);
  };

  const successCount = bulkResults.filter((r) => r.success).length;
  const failCount = bulkResults.filter((r) => !r.success).length;
  const totalCount = selectedRegistrarIds.size;
  const progress = totalCount > 0 ? ((successCount + failCount) / totalCount) * 100 : 0;

  return (
    <div className="h-full flex flex-col gap-6">
      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Left Column - Registrar Selection */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Select Registrars</span>
              {selectedRegistrarIds.size > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {selectedRegistrarIds.size}/{registrars.length}
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border/50 bg-card/50 shadow-card">
            {registrars.length === 0 ? (
              <EmptyState compact variant="inline" title="No registrars configured" />
            ) : (
              (Object.keys(REGISTRAR_CATEGORIES) as Array<keyof typeof REGISTRAR_CATEGORIES>).map((category) => {
                const categoryInfo = REGISTRAR_CATEGORIES[category];
                const CategoryIcon = categoryInfo.icon;
                const categoryRegs = registrarsByCategory[category] || [];
                const isCollapsed = collapsedRegistrarCategories.has(category);
                const selectedCount = getRegistrarCategorySelectedCount(category);
                const allSelected = categoryRegs.length > 0 && selectedCount === categoryRegs.length;
                const noneSelected = selectedCount === 0;
                
                // Skip empty categories
                if (categoryRegs.length === 0) return null;
                
                return (
                  <div key={category}>
                    {/* Category Header */}
                    <div className="flex items-center border-b border-border bg-muted/30">
                      <Checkbox
                        checked={allSelected ? true : noneSelected ? false : "indeterminate"}
                        onCheckedChange={(checked) => {
                          toggleRegistrarCategorySelection(category, !!checked);
                        }}
                        className="ml-4"
                      />
                      <TooltipWrapper title={isCollapsed ? "Expand category" : "Collapse category"} description={isCollapsed ? "Show registrars in this category." : "Hide the list of registrars."}>
                        <button
                          onClick={() => toggleRegistrarCategory(category)}
                          className="flex items-center gap-2 px-3 py-2.5 flex-1 hover:bg-muted/50 transition-smooth"
                        >
                          <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{categoryInfo.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {selectedCount}/{categoryRegs.length}
                          </span>
                          <div className="flex-1" />
                          {isCollapsed ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </TooltipWrapper>
                    </div>
                    
                    {/* Category Registrars */}
                    {!isCollapsed && (
                      <div className="divide-y divide-border/30">
                        {categoryRegs.map((registrar) => {
                          if (!registrar.id) return null;
                          const isSelected = selectedRegistrarIds.has(registrar.id);
                          return (
                            <label
                              key={registrar.id}
                              className={cn(
                                "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-smooth",
                                isSelected ? "bg-muted/20" : "hover:bg-muted/30"
                              )}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRegistrar(registrar.id!)}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{registrar.name}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {registrar.username}@{registrar.domain}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column - Test Selection */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TestTube className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Select Tests</span>
              {selectedTestTypes.size > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {selectedTestTypes.size}/{TEST_TYPES.length}
                </Badge>
              )}
            </div>
          </div>
          
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border/50 bg-card/50 shadow-card">
            {(Object.keys(TEST_CATEGORIES) as Array<keyof typeof TEST_CATEGORIES>).map((category) => {
              const categoryInfo = TEST_CATEGORIES[category];
              const CategoryIcon = categoryInfo.icon;
              const tests = testsByCategory[category] || [];
              const isCollapsed = collapsedCategories.has(category);
              const selectedCount = getCategorySelectedCount(category);
              const allSelected = selectedCount === tests.length;
              const noneSelected = selectedCount === 0;
              
              return (
                <div key={category}>
                  {/* Category Header */}
                  <div className="flex items-center border-b border-border bg-muted/30">
                    <Checkbox
                      checked={allSelected ? true : noneSelected ? false : "indeterminate"}
                      onCheckedChange={(checked) => {
                        if (isRunning || bulkOperationInProgress) return;
                        toggleCategoryTests(category, !!checked);
                      }}
                      disabled={isRunning || bulkOperationInProgress}
                      className="ml-4"
                    />
                    <TooltipWrapper title={isCollapsed ? "Expand category" : "Collapse category"} description={isCollapsed ? "Show test types in this category." : "Hide the list of test types."}>
                      <button
                        onClick={() => toggleCategory(category)}
                        className="flex items-center gap-2 px-3 py-2.5 flex-1 hover:bg-muted/50 transition-smooth"
                      >
                        <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{categoryInfo.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {selectedCount}/{tests.length}
                        </span>
                        <div className="flex-1" />
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TooltipWrapper>
                  </div>
                  
                  {/* Category Tests */}
                  {!isCollapsed && (
                    <div className="divide-y divide-border/30">
                      {tests.map((test) => {
                        const isSelected = selectedTestTypes.has(test.id);
                        return (
                          <label
                            key={test.id}
                            className={cn(
                              "flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-smooth",
                              isRunning || bulkOperationInProgress ? "opacity-50 cursor-not-allowed" : "",
                              isSelected ? "bg-muted/20" : "hover:bg-muted/30"
                            )}
                          >
                            <Checkbox
                              checked={isSelected}
                              disabled={isRunning || bulkOperationInProgress}
                              onCheckedChange={() => {
                                if (isRunning || bulkOperationInProgress) return;
                                const newSelection = new Set(selectedTestTypes);
                                if (isSelected) {
                                  newSelection.delete(test.id);
                                } else {
                                  newSelection.add(test.id);
                                }
                                setSelectedTestTypes(newSelection);
                              }}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm">{test.label}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {test.description}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex-shrink-0 flex items-center gap-3 p-4 rounded-lg bg-muted/30 shadow-card">
        <div className="flex items-center gap-2 flex-1">
          <TooltipWrapper title="Run Tests" description={`Run ${selectedTestTypes.size} test(s) on ${selectedRegistrarIds.size} registrar(s).`}>
            <Button
              onClick={handleBulkTest}
              disabled={isRunning || bulkOperationInProgress || selectedRegistrarIds.size === 0 || selectedTestTypes.size === 0}
              size="sm"
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Run Tests
            </Button>
          </TooltipWrapper>
          
          <div className="h-4 w-px bg-border" />
          
          <TooltipWrapper title="Register" description={`Register ${selectedRegistrarIds.size} selected registrar(s) with the SIP server.`}>
            <Button
              onClick={handleBulkRegister}
              disabled={isRunning || bulkOperationInProgress || selectedRegistrarIds.size === 0}
              variant="ghost"
              size="sm"
              className="gap-2"
            >
              <LinkConnect className="h-4 w-4" />
              Register
            </Button>
          </TooltipWrapper>
          
          <TooltipWrapper title="Unregister" description={`Unregister ${selectedRegistrarIds.size} selected registrar(s) from the SIP server.`}>
            <Button
              onClick={handleBulkUnregister}
              disabled={isRunning || bulkOperationInProgress || selectedRegistrarIds.size === 0}
              variant="ghost"
              size="sm"
              className="gap-2"
            >
              <LinkDisconnect className="h-4 w-4" />
              Unregister
            </Button>
          </TooltipWrapper>
        </div>
        
        <TooltipWrapper title="Export" description="Export test results or selected registrars to a report file.">
          <Button
            onClick={handleExport}
            disabled={bulkOperationInProgress}
            variant="neutral"
            size="sm"
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </TooltipWrapper>
      </div>

      {/* Progress Indicator */}
      {(bulkOperationInProgress || isRunning) && (
        <div className="flex-shrink-0 p-4 rounded-lg bg-muted/30 shadow-card space-y-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 animate-spin text-foreground" />
              <span className="font-medium">
                {operationType === "test" && "Running tests..."}
                {operationType === "register" && "Registering..."}
                {operationType === "unregister" && "Unregistering..."}
              </span>
            </div>
            <span className="text-muted-foreground tabular-nums">
              {successCount + failCount} / {totalCount}
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      {/* Results */}
      {bulkResults.length > 0 && !bulkOperationInProgress && (
        <div className="flex-shrink-0 rounded-lg border border-border/50 bg-card/50 shadow-card overflow-hidden">
          {/* Results Header */}
          <TooltipWrapper title={resultsExpanded ? "Collapse results" : "Expand results"} description={resultsExpanded ? "Hide the list of bulk test results." : "Show the list of bulk test results."}>
            <button
              onClick={() => setResultsExpanded(!resultsExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-smooth"
            >
              <div className="flex items-center gap-4">
              <span className="text-sm font-medium">Results</span>
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  {successCount}
                </span>
                <span className="flex items-center gap-1.5 text-destructive">
                  <XCircle className="h-4 w-4" />
                  {failCount}
                </span>
              </div>
            </div>
            {resultsExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
            </button>
          </TooltipWrapper>
          
          {/* Results List */}
          {resultsExpanded && (
            <div className="border-t border-border max-h-64 overflow-y-auto">
              <div className="divide-y divide-border">
                {bulkResults.map((result, index) => {
                  const registrarName = registrarNameById.get(result.registrar_id) ?? "Unknown registrar";
                  return (
                    <div
                      key={index}
                      className={cn(
                        "px-4 py-3 flex items-center gap-3",
                        result.success ? "bg-success/5" : "bg-destructive/5"
                      )}
                    >
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {registrarName}
                        </div>
                        {result.status_code && (
                          <div className="text-xs text-muted-foreground">
                            {result.status_code} {result.status_text}
                          </div>
                        )}
                        {result.error && (
                          <div className="text-xs text-destructive mt-1">{result.error}</div>
                        )}
                      </div>
                      {result.result?.tests && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {result.result.tests.map((test: any, idx: number) => {
                            const testTypeInfo = TEST_TYPES.find(t => t.id === test.test_type);
                            return (
                              <TooltipWrapper key={idx} title={testTypeInfo?.label || test.test_type} description={test.success ? "Passed" : "Failed"}>
                                <div
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    test.success ? "bg-success status-online" : "bg-destructive"
                                  )}
                                />
                              </TooltipWrapper>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Export Dialog */}
      <ReportExportDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        registrarIds={selectedRegistrarIds.size > 0 ? Array.from(selectedRegistrarIds) : undefined}
      />
    </div>
  );
}
