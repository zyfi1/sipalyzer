export interface SshExecuteDetail {
  command: string;
  password?: string;
  connectionId?: string;
}

interface DispatchSshExecuteOptions {
  detail: SshExecuteDetail;
  attempts?: number;
  retryDelayMs?: number;
}

/**
 * Dispatch SSH execution request and wait for terminal listener ACK.
 * Retries help when terminal is still mounting after opening.
 */
export async function dispatchSshExecuteWithAck({
  detail,
  attempts = 8,
  retryDelayMs = 250,
}: DispatchSshExecuteOptions): Promise<boolean> {
  const requestId = `ssh-exec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const payload = { ...detail, requestId };

  return await new Promise<boolean>((resolve) => {
    let done = false;
    let tries = 0;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener("ssh:execute:ack", onAck as EventListener);
      resolve(ok);
    };

    const onAck = (event: Event) => {
      const ack = (event as CustomEvent<{ requestId?: string }>).detail;
      if (ack?.requestId === requestId) finish(true);
    };

    const send = () => {
      tries += 1;
      window.dispatchEvent(new CustomEvent("ssh:execute", { detail: payload }));
      if (tries >= attempts) {
        window.setTimeout(() => finish(false), retryDelayMs);
      } else {
        window.setTimeout(() => {
          if (!done) send();
        }, retryDelayMs);
      }
    };

    window.addEventListener("ssh:execute:ack", onAck as EventListener);
    send();
  });
}
