/**
 * Request Scripts — pre/post-request script editor.
 * Provides Monaco-powered code editors for JavaScript snippets
 * that run before and after requests.
 *
 * Phase 7: Basic editor with syntax highlighting. Sandbox execution deferred.
 */

import { useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Play, Code } from "@/lib/icons";
import { useToastContext } from "@/contexts/ToastContext";

interface SyntaxValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

function validateScriptSyntax(script: string): SyntaxValidationResult {
  const stack: Array<{ char: "(" | "[" | "{"; line: number; column: number }> = [];
  let line = 1;
  let column = 0;
  let i = 0;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  while (i < script.length) {
    const ch = script[i];
    const next = script[i + 1];

    if (ch === "\n") {
      line += 1;
      column = 0;
      inLineComment = false;
      escaped = false;
      i += 1;
      continue;
    }

    column += 1;

    if (inLineComment) {
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        column += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i += 2;
        column += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        column += 1;
        continue;
      }
    }

    if (inSingleQuote || inDoubleQuote || inTemplate) {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        i += 1;
        continue;
      }
      if (inSingleQuote && ch === "'") {
        inSingleQuote = false;
      } else if (inDoubleQuote && ch === '"') {
        inDoubleQuote = false;
      } else if (inTemplate && ch === "`") {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      i += 1;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      i += 1;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push({ char: ch, line, column });
      i += 1;
      continue;
    }

    if (ch === ")" || ch === "]" || ch === "}") {
      const top = stack.pop();
      const expected =
        ch === ")" ? "(" :
        ch === "]" ? "[" :
        "{";

      if (!top || top.char !== expected) {
        return {
          isValid: false,
          errorMessage: `Mismatched '${ch}' at line ${line}, column ${column}.`,
        };
      }
    }

    i += 1;
  }

  if (inSingleQuote || inDoubleQuote || inTemplate) {
    return {
      isValid: false,
      errorMessage: "Unterminated string literal.",
    };
  }

  if (inBlockComment) {
    return {
      isValid: false,
      errorMessage: "Unterminated block comment.",
    };
  }

  if (stack.length > 0) {
    const last = stack[stack.length - 1];
    if (!last) {
      return {
        isValid: false,
        errorMessage: "Unclosed delimiter found.",
      };
    }
    return {
      isValid: false,
      errorMessage: `Unclosed '${last.char}' opened at line ${last.line}, column ${last.column}.`,
    };
  }

  return { isValid: true };
}

interface RequestScriptsProps {
  preScript: string;
  postScript: string;
  onChangePreScript: (script: string) => void;
  onChangePostScript: (script: string) => void;
}

export function RequestScripts({
  preScript,
  postScript,
  onChangePreScript,
  onChangePostScript,
}: RequestScriptsProps) {
  const toast = useToastContext();

  const handleTestScript = useCallback(
    (script: string, label: string) => {
      const result = validateScriptSyntax(script);
      if (result.isValid) {
        toast.success("Script Valid", `${label} script has valid syntax.`, { source: "composer" });
      } else {
        toast.error("Script Error", result.errorMessage ?? "Invalid syntax.", { source: "composer" });
      }
    },
    [toast]
  );

  return (
    <div className="space-y-2">
      <Tabs defaultValue="pre" className="flex flex-col">
        <TabsList className="subview-tabs-compact">
          <TabsTrigger value="pre" className="subview-tab-compact">
            <Code />
            Pre-request
          </TabsTrigger>
          <TabsTrigger value="post" className="subview-tab-compact">
            <Code />
            Post-request
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pre" className="mt-2 space-y-2">
          <p className="text-2xs text-muted-foreground">
            Runs before the request is sent. Use to set variables, generate tokens, etc.
          </p>
          <Textarea
            value={preScript}
            onChange={(e) => onChangePreScript(e.target.value)}
            placeholder={`// Pre-request script\n// Available: env.set("key", "value"), env.get("key")\nconsole.log("Before request");`}
            className="font-mono text-xs min-h-[100px]"
          />
          <Button
            variant="neutral"
            size="sm"
            onClick={() => handleTestScript(preScript, "Pre-request")}
            className="h-7 text-xs gap-1.5"
            disabled={!preScript.trim()}
          >
            <Play className="h-3 w-3" />
            Validate Syntax
          </Button>
        </TabsContent>

        <TabsContent value="post" className="mt-2 space-y-2">
          <p className="text-2xs text-muted-foreground">
            Runs after the response is received. Use to extract values, run assertions, etc.
          </p>
          <Textarea
            value={postScript}
            onChange={(e) => onChangePostScript(e.target.value)}
            placeholder={`// Post-request script\n// Available: response.status, response.body, response.headers\nconst data = JSON.parse(response.body);\nenv.set("token", data.token);`}
            className="font-mono text-xs min-h-[100px]"
          />
          <Button
            variant="neutral"
            size="sm"
            onClick={() => handleTestScript(postScript, "Post-request")}
            className="h-7 text-xs gap-1.5"
            disabled={!postScript.trim()}
          >
            <Play className="h-3 w-3" />
            Validate Syntax
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
