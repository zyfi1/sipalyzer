import { TestToolsView } from "./TestToolsView";

interface TestSuitePanelProps {
  registrarId: string;
}

export function TestSuitePanel({ registrarId }: TestSuitePanelProps) {
  return <TestToolsView registrarId={registrarId} />;
}
