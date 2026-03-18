export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    const match = url.pathname.match(/^\/session\/([^/]+)\/(controller|agent)$/);
    if (!match) {
      return new Response("Expected /session/{id}/{controller|agent}", { status: 404 });
    }

    const [, sessionId, role] = match;

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const id = env.RELAY_SESSION.idFromName(sessionId);
    const stub = env.RELAY_SESSION.get(id);

    const newHeaders = new Headers(request.headers);
    newHeaders.set("X-Role", role);
    const newRequest = new Request(request.url, {
      method: request.method,
      headers: newHeaders,
    });

    return stub.fetch(newRequest);
  },
};

export class RelaySession {
  constructor(ctx, env) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const role = request.headers.get("X-Role");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [role]);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket !== ws) {
        try {
          socket.send(message);
        } catch (e) {
          // peer disconnected
        }
      }
    }
  }

  webSocketClose(ws, code, reason) {
    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket !== ws) {
        try {
          socket.close(1000, "Peer disconnected");
        } catch (e) {}
      }
    }
  }

  webSocketError(ws, error) {
    ws.close(1011, "WebSocket error");
  }
}
