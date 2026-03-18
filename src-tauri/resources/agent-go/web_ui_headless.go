//go:build notray

package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

func startLocalWebUI(config *AgentConfig) (func(), string, error) {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(buildTrayData(config))
	})

	mux.HandleFunc("/api/reconnect", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		TriggerReconnect()
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/api/chat/read", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		markTrayChatRead()
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/api/chat/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload struct {
			Text string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		text := strings.TrimSpace(payload.Text)
		if text == "" {
			http.Error(w, "text is required", http.StatusBadRequest)
			return
		}
		addTrayChatMessage("remote", text, false)
		queueOutboundChat(text, "remote")
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		shutdown.Store(true)
		cancelAllActiveSessions()
		w.WriteHeader(http.StatusNoContent)
		go func() {
			time.Sleep(50 * time.Millisecond)
			os.Exit(0)
		}()
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprint(w, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SIPalyzer Agent</title>
  <style>
    :root{
      --bg0:#070f1e;--bg1:#0c1b33;--card:rgba(15,31,56,.72);--card-border:rgba(137,170,220,.2);
      --soft:rgba(137,170,220,.12);--fg:#eaf1ff;--fg2:rgba(223,236,255,.76);--fg3:rgba(195,214,244,.52);
      --accent:#5b8eff;--ok:#34d399;--warn:#fbbf24;--bad:#f87171;
      --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      --sans:-apple-system,Segoe UI,system-ui,sans-serif;
    }
    *{box-sizing:border-box}
    html,body{height:100%;margin:0;font-family:var(--sans);color:var(--fg);
      background:
        radial-gradient(1300px 760px at -10% -10%,rgba(91,142,255,.35),transparent 55%),
        radial-gradient(1000px 650px at 120% 0%,rgba(52,211,153,.16),transparent 58%),
        linear-gradient(150deg,var(--bg0),var(--bg1) 55%,#0a1a31)}
    .shell{max-width:1120px;height:100%;margin:0 auto;padding:18px;display:flex;flex-direction:column;gap:12px}
    .panel{border:1px solid var(--card-border);background:var(--card);border-radius:14px;backdrop-filter:blur(8px);box-shadow:0 18px 42px rgba(3,9,18,.45)}
    .header{padding:16px 18px}
    .title-row{display:flex;align-items:center;gap:10px}
    .title{font-size:20px;font-weight:700;letter-spacing:-.02em}
    .badge{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid rgba(91,142,255,.4);background:rgba(91,142,255,.14);color:#cfe0ff}
    .status{margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px}
    .status-left{display:flex;align-items:center;gap:9px;min-width:0}
    .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    .dot.ok{background:var(--ok);box-shadow:0 0 12px rgba(52,211,153,.45)}
    .dot.warn{background:var(--warn);box-shadow:0 0 12px rgba(251,191,36,.35)}
    .dot.bad{background:var(--bad);box-shadow:0 0 12px rgba(248,113,113,.35)}
    .status-text{font-size:13px;font-weight:600;color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pill{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:4px 9px;border:1px solid var(--soft);background:rgba(137,170,220,.14);color:var(--fg2)}
    .pill.ok{border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.15);color:#b7f4da}
    .pill.warn{border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.16);color:#ffe8b3}
    .pill.bad{border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.14);color:#ffd3d3}
    .reconnect{margin-top:10px;display:none}
    .btn{height:36px;padding:0 14px;border-radius:9px;border:1px solid transparent;background:transparent;color:var(--fg2);font-weight:600;cursor:pointer}
    .btn:hover{filter:brightness(1.06)}
    .btn.warn{border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.14);color:#ffd27e}
    .btn.primary{border-color:rgba(91,142,255,.45);background:linear-gradient(180deg,rgba(123,164,255,.32),rgba(91,142,255,.26));color:#ebf4ff}
    .btn.quit{width:100%;border-color:rgba(248,113,113,.32);background:rgba(248,113,113,.1);color:#ffcfcf}
    .main{flex:1;min-height:0;display:grid;grid-template-columns:1.4fr 1fr;gap:12px}
    .col{min-height:0;display:flex;flex-direction:column;gap:10px}
    .card{border:1px solid var(--soft);border-radius:12px;background:rgba(12,24,44,.58);padding:12px}
    .hostname{font-size:18px;font-weight:700}
    .identity{margin-top:4px;color:var(--fg3);font-size:11px;font-family:var(--mono)}
    .section{font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--fg3);margin-bottom:8px}
    .chat-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
    .chat-list{flex:1;min-height:180px;overflow:auto;border:1px solid var(--soft);border-radius:11px;padding:12px;background:rgba(7,16,32,.56);display:flex;flex-direction:column;gap:9px}
    .chat{padding:9px 11px;border-radius:12px;max-width:84%;box-shadow:0 8px 18px rgba(3,8,15,.32)}
    .chat.controller{align-self:flex-start;border:1px solid rgba(171,201,252,.2);background:rgba(171,201,252,.08)}
    .chat.remote{align-self:flex-end;border:1px solid rgba(91,142,255,.45);background:rgba(91,142,255,.2)}
    .chat-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}
    .chat-who{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg3)}
    .chat-time{font-size:10px;color:var(--fg3);font-family:var(--mono)}
    .chat-text{font-size:13px;line-height:1.35;color:var(--fg2);white-space:pre-wrap;word-break:break-word}
    .chat.remote .chat-text{color:#f0f6ff}
    .compose{margin-top:10px;display:flex;gap:8px}
    .input{flex:1;height:38px;border-radius:9px;border:1px solid var(--soft);background:rgba(7,16,32,.66);color:var(--fg);padding:0 12px;font-size:13px;outline:none}
    .input:focus{border-color:rgba(91,142,255,.55);box-shadow:0 0 0 3px rgba(91,142,255,.2)}
    .row{display:flex;gap:8px;align-items:baseline;margin-bottom:8px}
    .row:last-child{margin-bottom:0}
    .k{min-width:72px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--fg3)}
    .v{font-family:var(--mono);font-size:12px;color:var(--fg2)}
    .task{display:flex;gap:7px;align-items:center}
    .task-dot{width:7px;height:7px;border-radius:50%;background:var(--fg3)}
    .task-dot.run{background:var(--accent);box-shadow:0 0 10px rgba(91,142,255,.5)}
    .history{min-height:120px;border:1px solid var(--soft);border-radius:11px;padding:10px;background:rgba(7,16,32,.56)}
    .h-item{display:flex;align-items:center;gap:8px;padding:5px 0}
    .h-dot{width:6px;height:6px;border-radius:50%}
    .h-dot.ok{background:var(--ok)} .h-dot.bad{background:var(--bad)}
    .h-label{flex:1;font-size:12px;color:var(--fg2)} .h-ago{font-size:10px;color:var(--fg3);font-family:var(--mono)}
    .empty{font-size:12px;color:var(--fg3)}
    .footer{padding:0 2px}
    @media (max-width: 760px){.main{grid-template-columns:1fr;overflow:auto}}
  </style>
</head>
<body>
  <div class="shell">
    <div class="panel header">
      <div class="title-row">
        <div class="title">SIPalyzer Agent</div>
        <div class="badge">Full</div>
      </div>
      <div class="status">
        <div class="status-left">
          <div id="status-dot" class="dot warn"></div>
          <div id="status-text" class="status-text">Connecting...</div>
        </div>
        <div id="status-pill" class="pill warn">Connecting</div>
      </div>
      <div id="reconnect-wrap" class="reconnect">
        <button id="reconnect-btn" class="btn warn">Reconnect Now</button>
      </div>
    </div>

    <div class="main">
      <div class="col">
        <div class="card">
          <div id="hostname" class="hostname">-</div>
          <div id="identity" class="identity">-</div>
        </div>
        <div class="card chat-wrap">
          <div class="section">Live Chat</div>
          <div id="chat-list" class="chat-list"><div class="empty">No chat messages</div></div>
          <div class="compose">
            <input id="chat-input" class="input" type="text" placeholder="Reply to controller..." />
            <button id="chat-send" class="btn primary" type="button">Send</button>
          </div>
        </div>
      </div>

      <div class="col">
        <div class="card">
          <div class="section">System</div>
          <div class="row"><div class="k">Uptime</div><div id="uptime" class="v">-</div></div>
          <div class="row"><div class="k">Expires</div><div id="expires" class="v">-</div></div>
          <div class="row"><div class="k">Capture</div><div id="capture" class="v">Checking...</div></div>
        </div>
        <div class="card">
          <div class="section">Current Task</div>
          <div class="task"><div id="task-dot" class="task-dot"></div><div id="task-label">Idle</div></div>
        </div>
        <div class="card">
          <div class="section">Recent Activity</div>
          <div id="history" class="history"></div>
        </div>
      </div>
    </div>

    <div class="footer">
      <button id="quit-btn" class="btn quit" type="button">Quit Agent</button>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);

    function esc(value) {
      const div = document.createElement("div");
      div.textContent = String(value ?? "");
      return div.innerHTML;
    }

    function fmtAgo(isoStr) {
      if (!isoStr) return "";
      const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
      if (diff < 5) return "just now";
      if (diff < 60) return Math.floor(diff) + "s ago";
      if (diff < 3600) return Math.floor(diff / 60) + "m ago";
      if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
      return Math.floor(diff / 86400) + "d ago";
    }

    function fmtClock(isoStr) {
      if (!isoStr) return "";
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function renderStatus(s) {
      const dot = $("status-dot");
      const text = $("status-text");
      const pill = $("status-pill");
      const reconnect = $("reconnect-wrap");

      if (s.connected) {
        dot.className = "dot ok";
        text.textContent = "Connected to " + (s.controller_name || "SIPalyzer");
        pill.className = "pill ok";
        pill.textContent = "Connected";
        reconnect.style.display = "none";
      } else if ((s.conn_status || "") === "connecting") {
        dot.className = "dot warn";
        text.textContent = "Connecting to " + (s.controller_name || "SIPalyzer") + "...";
        pill.className = "pill warn";
        pill.textContent = "Connecting";
        reconnect.style.display = "none";
      } else {
        dot.className = "dot bad";
        if ((s.conn_status || "").startsWith("waiting:")) {
          text.textContent = "Reconnecting in " + s.conn_status.slice(8) + "...";
        } else {
          text.textContent = "Disconnected";
        }
        pill.className = "pill bad";
        pill.textContent = "Offline";
        reconnect.style.display = "block";
      }
    }

    function renderChat(messages) {
      const list = $("chat-list");
      if (!Array.isArray(messages) || messages.length === 0) {
        list.innerHTML = '<div class="empty">No chat messages</div>';
        return;
      }
      let html = "";
      for (const m of messages) {
        const sender = String(m.sender || "unknown");
        const kind = sender.toLowerCase() === "remote" ? "remote" : "controller";
        html +=
          '<div class="chat ' + kind + '">' +
            '<div class="chat-head">' +
              '<div class="chat-who">' + esc(sender) + "</div>" +
              '<div class="chat-time">' + esc(fmtClock(m.timestamp)) + "</div>" +
            "</div>" +
            '<div class="chat-text">' + esc(m.text || "") + "</div>" +
          "</div>";
      }
      list.innerHTML = html;
      list.scrollTop = list.scrollHeight;
    }

    function renderHistory(tasks) {
      const history = $("history");
      if (!Array.isArray(tasks) || tasks.length === 0) {
        history.innerHTML = '<div class="empty">No tasks yet</div>';
        return;
      }
      let html = "";
      for (const t of tasks) {
        html +=
          '<div class="h-item">' +
            '<div class="h-dot ' + (t.success ? "ok" : "bad") + '"></div>' +
            '<div class="h-label">' + esc(t.label || "") + "</div>" +
            '<div class="h-ago">' + esc(fmtAgo(t.completed)) + "</div>" +
          "</div>";
      }
      history.innerHTML = html;
    }

    function render(data) {
      renderStatus(data);
      $("hostname").textContent = data.hostname || "-";
      $("identity").textContent = (data.local_ip || "?") + " . " + (data.agent_id || "?");
      $("uptime").textContent = data.uptime || "-";
      $("expires").textContent = data.expires_in || "-";
      $("capture").textContent = data.capture_status && data.capture_status.available
        ? "Ready" + (data.capture_status.method ? " (" + data.capture_status.method + ")" : "")
        : "Needs permission";
      const running = data.current_task && data.current_task !== "Idle";
      $("task-dot").className = running ? "task-dot run" : "task-dot";
      $("task-label").textContent = running ? data.current_task : "Idle";
      renderHistory(data.recent_tasks);
      renderChat(data.chat_messages);
    }

    async function refresh() {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error("status fetch failed");
        const data = await res.json();
        render(data);
      } catch (_e) {}
    }

    async function post(path, body) {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : "{}",
      });
    }

    $("reconnect-btn").addEventListener("click", async () => {
      try { await post("/api/reconnect"); } catch (_e) {}
    });
    $("quit-btn").addEventListener("click", async () => {
      if (!confirm("Quit SIPalyzer Agent?")) return;
      try { await post("/api/quit"); } catch (_e) {}
    });
    $("chat-send").addEventListener("click", async () => {
      const input = $("chat-input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      try {
        await post("/api/chat/send", { text });
        await post("/api/chat/read");
        await refresh();
      } catch (_e) {}
    });
    $("chat-input").addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      $("chat-send").click();
    });

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`)
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, "", err
	}

	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		_ = server.Serve(listener)
	}()

	stop := func() {
		_ = server.Close()
	}
	return stop, "http://" + listener.Addr().String(), nil
}
