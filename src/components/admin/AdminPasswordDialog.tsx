import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setAdminPassword, verifyAdminPassword } from "@/api/admin";
import { cn } from "@/lib/utils";
import { Shield, Eye, EyeOff } from "@/lib/icons";

interface AdminPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /** "set" = first-time setup (new + confirm), "verify" = enter existing password */
  mode: "set" | "verify";
  onSuccess: () => void;
  /** If provided (verify mode only), called with the verified password. Useful when the caller needs the password for a follow-up action. */
  onVerified?: (password: string) => void;
}

export function AdminPasswordDialog({
  open,
  onClose,
  mode,
  onSuccess,
  onVerified,
}: AdminPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmPassword("");
      setError("");
      setLoading(false);
      setShowPassword(false);
    }
  }, [open]);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (mode === "set") {
      if (password.length < 4) {
        setError("Password must be at least 4 characters");
        triggerShake();
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        triggerShake();
        return;
      }
      setLoading(true);
      try {
        await setAdminPassword(password);
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to set password");
        triggerShake();
      } finally {
        setLoading(false);
      }
    } else {
      if (!password) {
        setError("Enter password");
        triggerShake();
        return;
      }
      setLoading(true);
      try {
        const ok = await verifyAdminPassword(password);
        if (ok) {
          onVerified?.(password);
          onSuccess();
        } else {
          setError("Incorrect password");
          triggerShake();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Verification failed");
        triggerShake();
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className={cn("max-w-sm gap-0 p-5", shake && "animate-[shake_0.5s_var(--motion-ease-emphasis)]")}
      >
        <DialogHeader className="mb-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md border border-primary/35 bg-primary/12 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">
                {mode === "set" ? "Set Admin Password" : "Admin Access"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {mode === "set"
                  ? "Create a password to protect the admin center."
                  : "Enter your admin password to continue."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="admin-pw" className="text-xs">
              Password
            </Label>
            <div className="relative">
              <Input
                id="admin-pw"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                autoFocus
                className="pr-9"
                placeholder={mode === "set" ? "New password" : "Enter password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-smooth"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {mode === "set" && (
            <div className="space-y-1.5">
              <Label htmlFor="admin-pw-confirm" className="text-xs">
                Confirm Password
              </Label>
              <Input
                id="admin-pw-confirm"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                }}
                placeholder="Confirm password"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive font-medium">{error}</p>
          )}

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="positive"
              disabled={loading}
              className="flex-1"
            >
              {loading
                ? "..."
                : mode === "set"
                  ? "Set Password"
                  : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
