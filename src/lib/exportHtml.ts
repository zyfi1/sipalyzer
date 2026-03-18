export interface HtmlColumn<T extends Record<string, unknown>> {
  key: keyof T;
  label: string;
  align?: "left" | "right" | "center";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildHtmlTableReport<T extends Record<string, unknown>>(params: {
  title: string;
  subtitle?: string;
  columns: Array<HtmlColumn<T>>;
  rows: T[];
}): string {
  const { title, subtitle, columns, rows } = params;
  const generatedAt = new Date().toLocaleString();
  const headerCells = columns
    .map((column, index) => {
      const klass =
        column.align === "right"
          ? "right"
          : column.align === "center"
            ? "center"
            : "left";
      return `<th class="${klass}"><button type="button" class="sort-btn ${klass}" data-col-index="${index}" aria-label="Sort by ${escapeHtml(column.label)}"><span>${escapeHtml(column.label)}</span><span class="sort-indicator" aria-hidden="true">↕</span></button></th>`;
    })
    .join("");
  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const raw = row[column.key];
          const plainText = asText(raw);
          const text = escapeHtml(plainText);
          const klass =
            column.align === "right"
              ? "right"
              : column.align === "center"
                ? "center"
                : "left";
          return `<td class="${klass}" data-sort-value="${escapeHtml(plainText)}">${text}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #080d16;
        --bg-elevated: #0f1726;
        --bg-header: #111a2b;
        --text: #e5edf8;
        --muted: #9fb0c9;
        --line: #24334b;
        --accent: #5ba4ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
        background:
          radial-gradient(1200px 700px at 20% -10%, rgba(91, 164, 255, 0.15), transparent),
          radial-gradient(900px 500px at 90% 0%, rgba(72, 222, 180, 0.12), transparent),
          var(--bg);
        color: var(--text);
      }
      .container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 14px;
      }
      .card {
        background: linear-gradient(180deg, rgba(16,24,39,0.92), rgba(16,24,39,0.82));
        border: 1px solid var(--line);
        border-radius: 12px;
        backdrop-filter: blur(6px);
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      }
      .header {
        padding: 12px 14px 10px;
        border-bottom: 1px solid var(--line);
      }
      h1 {
        margin: 0;
        font-size: 16px;
        line-height: 1.2;
        letter-spacing: 0.2px;
        font-weight: 650;
      }
      .meta {
        margin-top: 5px;
        color: var(--muted);
        font-size: 11px;
      }
      .subtitle {
        margin-top: 2px;
        color: var(--muted);
        font-size: 12px;
      }
      .table-wrap { overflow: auto; }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--line);
        background: rgba(7, 12, 20, 0.55);
      }
      .toolbar-label {
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 650;
      }
      .search {
        flex: 1;
        min-width: 220px;
        max-width: 520px;
        border: 1px solid var(--line);
        background: rgba(16, 24, 39, 0.9);
        color: var(--text);
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.2;
        padding: 7px 9px;
        outline: none;
      }
      .search::placeholder { color: #7f93b2; }
      .search:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px rgba(91, 164, 255, 0.2);
      }
      .result-count {
        margin-left: auto;
        color: var(--muted);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      thead th {
        position: sticky;
        top: 0;
        background: var(--bg-header);
        color: #d8e6fa;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 10px;
        font-weight: 650;
        border-bottom: 1px solid var(--line);
        z-index: 2;
      }
      th, td {
        padding: 7px 10px;
        border-bottom: 1px solid rgba(36, 51, 75, 0.65);
        vertical-align: top;
      }
      .sort-btn {
        width: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        padding: 0;
        margin: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font: inherit;
        text-transform: inherit;
        letter-spacing: inherit;
      }
      .sort-btn.left { justify-content: flex-start; }
      .sort-btn.right { justify-content: flex-end; }
      .sort-btn.center { justify-content: center; }
      .sort-indicator {
        color: var(--muted);
        font-size: 10px;
        line-height: 1;
      }
      .sort-btn.active .sort-indicator {
        color: var(--accent);
      }
      tbody tr:nth-child(even) td {
        background: rgba(255, 255, 255, 0.02);
      }
      tbody tr:hover td {
        background: rgba(91, 164, 255, 0.07);
      }
      .left { text-align: left; }
      .right {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .center { text-align: center; }
      .empty {
        padding: 14px;
        color: var(--muted);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main class="container">
      <section class="card">
        <header class="header">
          <h1>${escapeHtml(title)}</h1>
          ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ""}
          <div class="meta">Generated ${escapeHtml(generatedAt)} · ${rows.length.toLocaleString()} rows</div>
        </header>
        <div class="toolbar">
          <span class="toolbar-label">Filter</span>
          <input id="table-filter" class="search" type="search" placeholder="Search all columns..." aria-label="Filter rows" />
          <span id="result-count" class="result-count"></span>
        </div>
        <div class="table-wrap">
          ${
            rows.length > 0
              ? `<table id="report-table"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
              : `<div class="empty">No records available.</div>`
          }
        </div>
      </section>
    </main>
    <script>
      (function () {
        var table = document.getElementById("report-table");
        if (!table) return;
        var tbody = table.tBodies[0];
        if (!tbody) return;
        var filterInput = document.getElementById("table-filter");
        var resultCount = document.getElementById("result-count");

        var buttons = table.querySelectorAll(".sort-btn");
        var currentCol = -1;
        var currentDir = "asc";
        var allRows = Array.prototype.slice.call(tbody.rows);

        function updateCount() {
          if (!resultCount) return;
          var visible = 0;
          allRows.forEach(function (row) {
            if (row.style.display !== "none") visible += 1;
          });
          resultCount.textContent = visible.toLocaleString() + " / " + allRows.length.toLocaleString();
        }

        function applyFilter(query) {
          var q = String(query || "").trim().toLowerCase();
          allRows.forEach(function (row) {
            if (!q) {
              row.style.display = "";
              return;
            }
            var cells = Array.prototype.slice.call(row.cells);
            var haystack = cells
              .map(function (cell) {
                return (cell.getAttribute("data-sort-value") || cell.textContent || "").toLowerCase();
              })
              .join(" ");
            row.style.display = haystack.includes(q) ? "" : "none";
          });
          updateCount();
        }

        function compareValues(a, b) {
          var an = Number(a);
          var bn = Number(b);
          var aIsNum = a !== "" && Number.isFinite(an);
          var bIsNum = b !== "" && Number.isFinite(bn);
          if (aIsNum && bIsNum) return an - bn;
          return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
        }

        function sortBy(col, dir) {
          var rows = Array.prototype.slice.call(tbody.rows);
          rows.sort(function (rowA, rowB) {
            var aCell = rowA.cells[col];
            var bCell = rowB.cells[col];
            var a = aCell ? (aCell.getAttribute("data-sort-value") || "").trim() : "";
            var b = bCell ? (bCell.getAttribute("data-sort-value") || "").trim() : "";
            var result = compareValues(a, b);
            return dir === "asc" ? result : -result;
          });
          rows.forEach(function (row) {
            tbody.appendChild(row);
          });
          allRows = Array.prototype.slice.call(tbody.rows);
        }

        function updateIndicators(activeCol, dir) {
          Array.prototype.forEach.call(buttons, function (btn) {
            btn.classList.remove("active");
            var icon = btn.querySelector(".sort-indicator");
            if (icon) icon.textContent = "↕";
          });
          var active = table.querySelector('.sort-btn[data-col-index="' + activeCol + '"]');
          if (!active) return;
          active.classList.add("active");
          var activeIcon = active.querySelector(".sort-indicator");
          if (activeIcon) activeIcon.textContent = dir === "asc" ? "↑" : "↓";
        }

        Array.prototype.forEach.call(buttons, function (btn) {
          btn.addEventListener("click", function () {
            var idx = Number(btn.getAttribute("data-col-index"));
            if (!Number.isFinite(idx)) return;
            if (currentCol === idx) {
              currentDir = currentDir === "asc" ? "desc" : "asc";
            } else {
              currentCol = idx;
              currentDir = "asc";
            }
            sortBy(currentCol, currentDir);
            updateIndicators(currentCol, currentDir);
          });
        });

        if (filterInput) {
          filterInput.addEventListener("input", function (event) {
            var target = event.target;
            var value = target && typeof target.value === "string" ? target.value : "";
            applyFilter(value);
          });
        }

        applyFilter("");
      })();
    </script>
  </body>
</html>`;
}
