import { invokeTauri } from "./invoke";

export function setSshConnectionPassword(connectionId: string, password: string): Promise<void> {
  return invokeTauri<void>("set_ssh_connection_password", {
    connectionId,
    connection_id: connectionId,
    password,
  });
}

export function getSshConnectionPassword(connectionId: string): Promise<string | null> {
  return invokeTauri<string | null>("get_ssh_connection_password", {
    connectionId,
    connection_id: connectionId,
  });
}

export function deleteSshConnectionPassword(connectionId: string): Promise<void> {
  return invokeTauri<void>("delete_ssh_connection_password", {
    connectionId,
    connection_id: connectionId,
  });
}
