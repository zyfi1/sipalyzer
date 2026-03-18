import { useState } from "react";
import { useRegistrationStore } from "@/stores/registrationStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { TestToolPanel } from "./TestToolPanel";
import { RegistrarStatusView } from "./RegistrarStatusView";
import { CheckSquare, Square, Play } from "@/lib/icons";
import type { TestType } from "@/types/registration";
import { TEST_TYPES } from "@/types/registration";
import type { TestConfig } from "./TestConfigDialog";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { EmptyState } from "@/components/ui/empty-state";

interface TestToolsViewProps {
  registrarId: string;
}

export function TestToolsView({ registrarId }: TestToolsViewProps) {
  const registrars = useRegistrationStore((s) => s.registrars);
  const runTestSuite = useRegistrationStore((s) => s.runTestSuite);
  const testSuites = useRegistrationStore((s) => s.testSuites);
  const loading = useRegistrationStore((s) => s.loading);
  const { error: notifyError, success: notifySuccess } = useNotifications();
  const [runningTests, setRunningTests] = useState<Set<TestType>>(new Set());
  const [selectedTests, setSelectedTests] = useState<Set<TestType>>(new Set());
  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [testConfigs, setTestConfigs] = useState<Partial<Record<TestType, import("./TestConfigDialog").TestConfig>>>({} as Partial<Record<TestType, import("./TestConfigDialog").TestConfig>>);

  const registrar = registrars.find((r) => r.id === registrarId);
  const suiteResult = testSuites[registrarId];

  if (!registrar || !registrar.id) {
    return <div className="text-destructive p-4">Registrar not found or invalid</div>;
  }

  const handleRunTest = async (testType: TestType, config?: TestConfig) => {
    setRunningTests((prev) => new Set(prev).add(testType));
    try {
      const testConfigs = config ? { [testType]: config } : undefined;
      const result = await runTestSuite(registrar.id!, [testType], testConfigs);
      if (result.overall_success) {
        notifySuccess(
          "Test Completed",
          `${TEST_TYPES.find(t => t.id === testType)?.label || testType} passed successfully.`,
          {
            navigation: { tool: "registration", view: "reports", registrarId: registrar.id! },
            source: "registration",
          }
        );
      } else {
        notifyError(
          "Test Failed",
          result.tests[0]?.result.error || `${TEST_TYPES.find(t => t.id === testType)?.label || testType} failed.`,
          {
            navigation: { tool: "registration", view: "reports", registrarId: registrar.id! },
            source: "registration",
          }
        );
      }
    } catch (error) {
      console.error("Test error:", error);
      notifyError(
        "Test Failed",
        error instanceof Error ? error.message : "Unknown error occurred",
        {
          navigation: { tool: "registration", view: "reports", registrarId: registrar.id! },
          source: "registration",
        }
      );
    } finally {
      setRunningTests((prev) => {
        const next = new Set(prev);
        next.delete(testType);
        return next;
      });
    }
  };

  const handleConfigChange = (testType: TestType, config: TestConfig) => {
    setTestConfigs((prev) => ({
      ...prev,
      [testType]: config,
    }));
  };


  const handleRunSelected = async () => {
    if (selectedTests.size === 0) {
      notifyError("No Tests Selected", "Please select at least one test to run.", { source: "registration" });
      return;
    }

    setIsRunningBatch(true);
    try {
      const testTypesArray = Array.from(selectedTests);
      const selectedConfigs: Record<string, TestConfig> = {};
      testTypesArray.forEach((testType) => {
        if (testConfigs[testType]) {
          selectedConfigs[testType] = testConfigs[testType];
        }
      });
      const result = await runTestSuite(registrar.id!, testTypesArray, Object.keys(selectedConfigs).length > 0 ? selectedConfigs : undefined);

      if (result.overall_success) {
        notifySuccess(
          "Test Suite Completed",
          `All ${result.passed_tests} tests passed successfully.`,
          { source: "registration" }
        );
      } else {
        notifyError(
          "Test Suite Completed with Failures",
          `${result.failed_tests} of ${result.total_tests} tests failed.`,
          { source: "registration" }
        );
      }
    } catch (error) {
      console.error("Test suite error:", error);
      notifyError(
        "Test Suite Failed",
        error instanceof Error ? error.message : "Unknown error occurred",
        { source: "registration" }
      );
    } finally {
      setIsRunningBatch(false);
    }
  };

  const toggleTestSelection = (testType: TestType) => {
    setSelectedTests((prev) => {
      const next = new Set(prev);
      if (next.has(testType)) {
        next.delete(testType);
      } else {
        next.add(testType);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const allTests = TEST_TYPES.map((t) => t.id);
    setSelectedTests(new Set(allTests));
  };

  const handleDeselectAll = () => {
    setSelectedTests(new Set());
  };

  const getTestResult = (testType: TestType) => {
    if (!suiteResult) return undefined;
    return suiteResult.tests.find((t) => t.test_type === testType);
  };

  const categories = [
    { id: "basic", label: "Basic", tests: TEST_TYPES.filter(t => t.category === "basic") },
    { id: "network", label: "Network", tests: TEST_TYPES.filter(t => t.category === "network") },
    { id: "status", label: "Status", tests: [] },
  ];

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TooltipWrapper title="Select All" description="Select all tests for batch run.">
            <Button
              onClick={handleSelectAll}
              disabled={isRunningBatch || loading || runningTests.size > 0}
              variant="ghost"
              size="sm"
              className="h-8 px-3 gap-2"
            >
              <CheckSquare className="h-4 w-4" />
              <span className="text-xs">Select All</span>
            </Button>
          </TooltipWrapper>
          <TooltipWrapper title="Deselect All" description="Clear test selection.">
            <Button
              onClick={handleDeselectAll}
              disabled={isRunningBatch || loading || runningTests.size > 0}
              variant="ghost"
              size="sm"
              className="h-8 px-3 gap-2"
            >
              <Square className="h-4 w-4" />
              <span className="text-xs">Deselect All</span>
            </Button>
          </TooltipWrapper>
        </div>
        {selectedTests.size > 0 && (
          <TooltipWrapper title={`Run ${selectedTests.size} test${selectedTests.size > 1 ? 's' : ''}`} description="Execute all selected tests for this registrar.">
            <Button
              onClick={handleRunSelected}
              disabled={isRunningBatch || loading || runningTests.size > 0}
              size="sm"
              className="h-8"
            >
              <Play className="mr-2 h-3.5 w-3.5" />
              Run {selectedTests.size}
            </Button>
          </TooltipWrapper>
        )}
      </div>

      {/* Test Categories */}
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="subview-tabs-compact">
          {categories.map((category) => (
            <TabsTrigger
              key={category.id}
              value={category.id}
              className="subview-tab-compact"
              disabled={category.id === "status" ? false : category.tests.length === 0}
            >
              {category.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {categories.map((category) => (
          <TabsContent key={category.id} value={category.id} className="mt-4">
            {category.id === "status" ? (
              <RegistrarStatusView registrarId={registrar.id!} />
            ) : category.tests.length === 0 ? (
              <EmptyState compact variant="inline" title="No tests available" />
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2">
                  {category.tests.map((test) => {
                    const isSelected = selectedTests.has(test.id);
                    return (
                      <div
                        key={test.id}
                        onClick={() => toggleTestSelection(test.id)}
                        className={cn(
                          "cursor-pointer transition-smooth",
                          isSelected
                            ? "ring-2 ring-foreground/20 ring-offset-0"
                            : ""
                        )}
                      >
                        <TestToolPanel
                          testType={test.id}
                          registrarId={registrar.id!}
                          onRun={handleRunTest}
                          isRunning={runningTests.has(test.id)}
                          result={getTestResult(test.id)}
                          config={testConfigs[test.id]}
                          onConfigChange={handleConfigChange}
                          isSelected={isSelected}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
