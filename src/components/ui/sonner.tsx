import {
  CheckCircle2,
  Info,
  Loader2,
  AlertTriangle,
  XCircle,
} from "@/lib/icons"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const TOAST_DURATION = 5000

const Toaster = ({ duration = TOAST_DURATION, ...props }: ToasterProps) => {
  const { theme = "dark" } = useTheme()

  return (
    <Sonner
      theme={(theme === "system" ? "dark" : theme) as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      duration={duration}
      icons={{
        success: <CheckCircle2 className="size-5 text-success drop-shadow-[0_0_6px_hsl(var(--success)/0.6)]" />,
        info: <Info className="size-5 text-primary drop-shadow-[0_0_6px_hsl(var(--primary)/0.5)]" />,
        warning: <AlertTriangle className="size-5 text-warning drop-shadow-[0_0_6px_hsl(var(--warning)/0.6)]" />,
        error: <XCircle className="size-5 text-destructive drop-shadow-[0_0_6px_hsl(var(--destructive)/0.6)]" />,
        loading: <Loader2 className="size-5 animate-spin text-primary drop-shadow-[0_0_6px_hsl(var(--primary)/0.5)]" />,
      }}
      style={
        {
          "--normal-bg": "hsl(var(--card))",
          "--normal-text": "hsl(var(--foreground))",
          "--normal-border": "transparent",
          "--border-radius": "0.75rem",
          "--toast-duration": `${duration}ms`,
        } as React.CSSProperties
      }
      toastOptions={{
        className: "toast-enhanced",
        classNames: {
          toast: "toast-enhanced",
          title: "text-sm font-semibold",
          description: "text-sm text-muted-foreground",
          closeButton: "toast-close-button",
        },
        style: {
          "--toast-duration": `${duration}ms`,
        } as React.CSSProperties,
      }}
      {...props}
    />
  )
}

export { Toaster }
