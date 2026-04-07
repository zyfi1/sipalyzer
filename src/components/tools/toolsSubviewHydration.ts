export function shouldDeferToolsSubviewHydration(
  subviewId: string,
  flags: {
    mcpEnabled: boolean;
    mcpLoading: boolean;
    mockupEnabled: boolean;
    mockupLoading: boolean;
  }
): boolean {
  if (subviewId === "mcp") {
    return !flags.mcpEnabled && flags.mcpLoading;
  }
  if (subviewId === "mockup") {
    return !flags.mockupEnabled && flags.mockupLoading;
  }
  return false;
}
