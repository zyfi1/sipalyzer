import { TEST_TYPES, type TestType } from "@/types/registration";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle2, 
  RefreshCw, 
  XCircle, 
  Network, 
  Globe, 
  Clock, 
  Phone, 
  AlertTriangle,
  Play,
  Shield,
  Activity
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

interface TestTypeSelectorProps {
  selectedTypes: Set<TestType>;
  onSelectionChange: (types: Set<TestType>) => void;
  onRunTest: (testType: TestType) => void;
  runningTests: Set<TestType>;
  registrarId?: string;
}

const testIcons: Record<TestType, typeof CheckCircle2> = {
  basic_registration: CheckCircle2,
  reregistration: RefreshCw,
  deregistration: XCircle,
  network_connectivity: Network,
  transport_validation: Globe,
  expires_header: Clock,
  contact_header: Phone,
  error_handling: AlertTriangle,
  nat_traversal: Shield,
  firewall_test: Shield,
  dns_srv_test: Globe,
  registration_stability: Activity,
  network_conditions: Network,
  multi_transport: Globe,
};

export function TestTypeSelector({ 
  selectedTypes, 
  onSelectionChange, 
  onRunTest,
  runningTests,
}: TestTypeSelectorProps) {
  const categories = [
    { id: "basic", label: "Basic Tests", color: "text-primary" },
    { id: "diagnostic", label: "Diagnostic Tests", color: "text-success" },
    { id: "advanced", label: "Advanced Tests", color: "text-warning" },
  ] as const;

  const toggleTestType = (testType: TestType, e: React.MouseEvent) => {
    // If clicking the run button, don't toggle selection
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    const newSelection = new Set(selectedTypes);
    if (newSelection.has(testType)) {
      newSelection.delete(testType);
    } else {
      newSelection.add(testType);
    }
    onSelectionChange(newSelection);
  };

  const handleRunTest = (testType: TestType, e: React.MouseEvent) => {
    e.stopPropagation();
    onRunTest(testType);
  };

  const selectAll = () => {
    onSelectionChange(new Set(TEST_TYPES.map((t) => t.id)));
  };

  const deselectAll = () => {
    onSelectionChange(new Set());
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="flex items-center justify-end">
          <div className="flex gap-2">
            <TooltipWrapper title="Select All" description="Select all test types.">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="text-sm"
              >
                Select All
              </Button>
            </TooltipWrapper>
            <TooltipWrapper title="Clear" description="Deselect all test types.">
              <Button
                variant="ghost"
                size="sm"
                onClick={deselectAll}
                className="text-sm"
              >
                Clear
              </Button>
            </TooltipWrapper>
          </div>
        </div>
        {categories.map((category) => {
          const categoryTests = TEST_TYPES.filter((t) => t.category === category.id);
          if (categoryTests.length === 0) return null;
          
          return (
            <div key={category.id} className="space-y-3">
              <h4 className={cn("text-sm font-semibold", category.color)}>
                {category.label}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {categoryTests.map((test) => {
                  const Icon = testIcons[test.id];
                  const isSelected = selectedTypes.has(test.id);
                  const isRunning = runningTests.has(test.id);
                  
                  return (
                    <div
                      key={test.id}
                      onClick={(e) => toggleTestType(test.id, e)}
                      className={cn(
                        "relative p-4 rounded-lg border-2 transition-smooth cursor-pointer",
                        "hover:border-border hover:shadow-card-hover hover-lift",
                        isSelected
                          ? "border-foreground/30 bg-muted/20 shadow-card"
                          : "border-border bg-card"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-2 rounded-lg flex-shrink-0",
                          isSelected ? "bg-muted/40 text-foreground" : "bg-muted text-muted-foreground"
                        )}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h5 className="font-semibold text-sm">{test.label}</h5>
                            {isSelected && (
                              <CheckCircle2 className="h-4 w-4 text-foreground flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {test.description}
                          </p>
                        </div>
                        <TooltipWrapper title="Run test" description={`Run ${test.label} for the selected registrar.`}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleRunTest(test.id, e)}
                          disabled={isRunning}
                          className="flex-shrink-0"
                        >
                          {isRunning ? (
                            <Clock className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                        </TooltipWrapper>
                      </div>
                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <div className="h-2 w-2 rounded-full bg-accent" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
