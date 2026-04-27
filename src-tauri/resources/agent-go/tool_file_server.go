package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func hasFileServeProtocol(protocols []string, name string) bool {
	for _, x := range protocols {
		if x == name {
			return true
		}
	}
	return false
}

// RunFileServe starts HTTP (and optionally TFTP, FTP) servers and streams request logs via ch.
func RunFileServe(ctx context.Context, p FileServeParams, ch chan<- ToolResponse) {
	defer close(ch)

	if p.HTTPPort == 0 {
		p.HTTPPort = 8080
	}
	if p.TFTPPort == 0 {
		p.TFTPPort = 69
	}
	if p.FtpPort == 0 {
		p.FtpPort = 2121
	}

	// Determine serve directory
	serveDir := p.Path
	var pushedFiles map[string][]byte

	if len(p.Files) > 0 {
		// Push mode: write files to a temp directory
		tmpDir, err := os.MkdirTemp("", "sipalyzer-serve-*")
		if err != nil {
			ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "FILE_SERVE_ERROR", Message: fmt.Sprintf("create temp dir: %v", err)}}
			return
		}
		defer os.RemoveAll(tmpDir)
		serveDir = tmpDir
		pushedFiles = make(map[string][]byte)

		for _, f := range p.Files {
			data, err := base64.StdEncoding.DecodeString(f.ContentBase64)
			if err != nil {
				ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "FILE_SERVE_ERROR", Message: fmt.Sprintf("decode %s: %v", f.Name, err)}}
				return
			}
			fpath := filepath.Join(tmpDir, f.Name)
			if err := os.WriteFile(fpath, data, 0644); err != nil {
				ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "FILE_SERVE_ERROR", Message: fmt.Sprintf("write %s: %v", f.Name, err)}}
				return
			}
			pushedFiles[f.Name] = data
		}
	} else if serveDir == "" {
		ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "FILE_SERVE_ERROR", Message: "path or files required"}}
		return
	}

	localIP := getLocalIP()
	if localIP == "" {
		localIP = "0.0.0.0"
	}

	httpServing := false
	for _, proto := range p.Protocols {
		if proto == "http" {
			httpServing = true
		}
	}
	if len(p.Protocols) == 0 {
		httpServing = true
	}

	httpURL := ""
	if httpServing {
		httpURL = fmt.Sprintf("http://%s:%d", localIP, p.HTTPPort)
	}

	tftpURL := ""
	if hasFileServeProtocol(p.Protocols, "tftp") {
		tftpURL = fmt.Sprintf("tftp://%s:%d", localIP, p.TFTPPort)
	}

	ftpURL := ""

	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{
			Message: "Starting servers",
			Partial: FileServeStatus{
				HttpURL: httpURL,
				TftpURL: tftpURL,
				FtpURL:  ftpURL,
				Serving: true,
			},
		},
	}

	if httpServing {
		mux := http.NewServeMux()

		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &responseRecorder{ResponseWriter: w, status: 200}

			serveStyledHTTP(rw, r, serveDir)

			duration := time.Since(start)
			req := FileServeRequest{
				Timestamp:  time.Now().Format(time.RFC3339),
				ClientIP:   r.RemoteAddr,
				Filename:   r.URL.Path,
				Status:     rw.status,
				BytesSent:  uint64(rw.written),
				DurationMs: uint64(duration.Milliseconds()),
				Protocol:   "http",
			}

			select {
			case ch <- ToolResponse{
				Type: "Progress",
				Data: ProgressData{
					Message: fmt.Sprintf("%s %s %s", r.RemoteAddr, r.Method, r.URL.Path),
					Partial: req,
				},
			}:
			default:
			}
		})

		addr := fmt.Sprintf(":%d", p.HTTPPort)
		listener, err := net.Listen("tcp", addr)
		if err != nil {
			ch <- ToolResponse{Type: "Error", Data: ErrorData{Code: "FILE_SERVE_ERROR", Message: fmt.Sprintf("http listen %s: %v", addr, err)}}
			return
		}

		server := &http.Server{Handler: mux}
		go func() {
			if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
				log.Printf("[FileServe] HTTP error: %v", err)
			}
		}()

		go func() {
			<-ctx.Done()
			server.Close()
		}()

		log.Printf("[FileServe] HTTP serving %s on %s", serveDir, addr)
	}

	for _, proto := range p.Protocols {
		if proto == "tftp" {
			go runSimpleTFTP(ctx, serveDir, p.TFTPPort, ch)
		}
	}

	if hasFileServeProtocol(p.Protocols, "ftp") {
		ready := make(chan string, 1)
		go runSimpleFTP(ctx, serveDir, localIP, p.FtpPort, ch, ready)
		select {
		case u := <-ready:
			ftpURL = u
		case <-time.After(3 * time.Second):
		}
	}

	statusParts := []string{}
	if httpURL != "" {
		statusParts = append(statusParts, "HTTP "+httpURL)
	}
	if tftpURL != "" {
		statusParts = append(statusParts, "TFTP "+tftpURL)
	}
	if ftpURL != "" {
		statusParts = append(statusParts, "FTP "+ftpURL)
	}
	statusMsg := "Serving"
	if len(statusParts) > 0 {
		statusMsg += ": " + strings.Join(statusParts, ", ")
	}

	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{
			Message: statusMsg,
			Partial: FileServeStatus{
				HttpURL: httpURL,
				TftpURL: tftpURL,
				FtpURL:  ftpURL,
				Serving: true,
			},
		},
	}

	if p.DurationSecs > 0 {
		select {
		case <-ctx.Done():
		case <-time.After(time.Duration(p.DurationSecs) * time.Second):
		}
	} else {
		<-ctx.Done()
	}

	ch <- ToolResponse{
		Type: "Result",
		Data: ResultData{
			Success: true,
			Result: FileServeStatus{
				HttpURL: httpURL,
				TftpURL: tftpURL,
				FtpURL:  ftpURL,
				Serving: false,
			},
		},
	}
}

type responseRecorder struct {
	http.ResponseWriter
	status  int
	written int64
}

func (rw *responseRecorder) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseRecorder) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.written += int64(n)
	return n, err
}

// runSimpleTFTP implements a minimal TFTP read-only server (RRQ only).
func runSimpleTFTP(ctx context.Context, dir string, port uint16, ch chan<- ToolResponse) {
	addr := fmt.Sprintf(":%d", port)
	pc, err := net.ListenPacket("udp4", addr)
	if err != nil {
		log.Printf("[FileServe] TFTP listen error: %v", err)
		return
	}
	defer pc.Close()
	log.Printf("[FileServe] TFTP serving %s on %s", dir, addr)

	go func() {
		<-ctx.Done()
		pc.Close()
	}()

	buf := make([]byte, 516)
	for {
		n, clientAddr, err := pc.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			continue
		}
		if n < 4 {
			continue
		}

		opcode := uint16(buf[0])<<8 | uint16(buf[1])
		if opcode != 1 { // RRQ
			continue
		}

		// Parse filename (null-terminated after opcode)
		filename := ""
		for i := 2; i < n; i++ {
			if buf[i] == 0 {
				filename = string(buf[2:i])
				break
			}
		}
		if filename == "" {
			continue
		}

		go serveTFTPFile(ctx, dir, filename, clientAddr, ch)
	}
}

func serveTFTPFile(ctx context.Context, dir, filename string, clientAddr net.Addr, ch chan<- ToolResponse) {
	start := time.Now()
	fpath := filepath.Join(dir, filepath.Clean(filename))

	data, err := os.ReadFile(fpath)
	if err != nil {
		log.Printf("[FileServe] TFTP: file not found: %s", filename)
		return
	}

	conn, err := net.Dial("udp4", clientAddr.String())
	if err != nil {
		return
	}
	defer conn.Close()

	blockNum := uint16(1)
	offset := 0
	blockSize := 512

	for {
		if ctx.Err() != nil {
			return
		}

		end := offset + blockSize
		if end > len(data) {
			end = len(data)
		}

		// DATA packet: opcode(3) + block# + data
		pkt := make([]byte, 4+end-offset)
		pkt[0] = 0
		pkt[1] = 3
		pkt[2] = byte(blockNum >> 8)
		pkt[3] = byte(blockNum)
		copy(pkt[4:], data[offset:end])

		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		conn.Write(pkt)

		// Wait for ACK
		ack := make([]byte, 4)
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, err := conn.Read(ack)
		if err != nil {
			return
		}

		if end-offset < blockSize {
			break // Last block
		}
		offset = end
		blockNum++
	}

	duration := time.Since(start)
	select {
	case ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{
			Message: fmt.Sprintf("TFTP: %s served to %s", filename, clientAddr.String()),
			Partial: FileServeRequest{
				Timestamp:  time.Now().Format(time.RFC3339),
				ClientIP:   clientAddr.String(),
				Filename:   filename,
				Status:     200,
				BytesSent:  uint64(len(data)),
				DurationMs: uint64(duration.Milliseconds()),
				Protocol:   "tftp",
			},
		},
	}:
	default:
	}
}

// serveStyledHTTP handles an HTTP request, serving files directly or
// rendering a styled directory listing that matches the local Rust server.
func serveStyledHTTP(w http.ResponseWriter, r *http.Request, rootDir string) {
	urlPath := filepath.Clean(r.URL.Path)
	if urlPath == "." {
		urlPath = "/"
	}

	rel := strings.TrimPrefix(urlPath, "/")
	fsPath := filepath.Join(rootDir, rel)
	fsPath = filepath.Clean(fsPath)
	if !strings.HasPrefix(fsPath, filepath.Clean(rootDir)) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	info, err := os.Stat(fsPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if !info.IsDir() {
		ct := mime.TypeByExtension(filepath.Ext(fsPath))
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
		f, err := os.Open(fsPath)
		if err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		defer f.Close()
		io.Copy(w, f)
		return
	}

	// Ensure directory URLs end with /
	if !strings.HasSuffix(r.URL.Path, "/") {
		http.Redirect(w, r, r.URL.Path+"/", http.StatusMovedPermanently)
		return
	}

	html := generateStyledListing(fsPath, r.URL.Path)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}

type dirEntryInfo struct {
	Name    string
	IsDir   bool
	Size    int64
	ModTime time.Time
}

func generateStyledListing(dirPath, urlPath string) string {
	rawEntries, err := os.ReadDir(dirPath)
	if err != nil {
		return "<html><body>Error reading directory</body></html>"
	}

	var entries []dirEntryInfo
	for _, e := range rawEntries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		entries = append(entries, dirEntryInfo{
			Name:    e.Name(),
			IsDir:   e.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	dirCount := 0
	fileCount := 0
	var totalSize int64
	for _, e := range entries {
		if e.IsDir {
			dirCount++
		} else {
			fileCount++
			totalSize += e.Size
		}
	}

	var b strings.Builder
	b.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Index of ` + htmlEsc(urlPath) + `</title>
<style>
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#0a0a0f;--surface:#12121a;--surface2:#1a1a26;--border:#222233;
  --text:#c8c8d8;--text2:#7878a0;--accent:#6c9cff;--accent-dim:#4a6aa0;
  --green:#4ade80;--amber:#fbbf24;--purple:#a78bfa;--red:#f87171;
}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;margin:0;padding:0;background:var(--bg);color:var(--text);min-height:100vh}
.wrap{max-width:960px;margin:0 auto;padding:32px 24px}
.header{margin-bottom:24px}
.header h1{font-size:14px;font-weight:600;color:var(--text);margin:0 0 6px;letter-spacing:-0.01em}
.breadcrumb{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text2);font-family:'SF Mono',Monaco,Consolas,monospace}
.breadcrumb a{color:var(--accent-dim);text-decoration:none}.breadcrumb a:hover{color:var(--accent);text-decoration:underline}
.breadcrumb .sep{opacity:0.3}
.stats{display:flex;gap:16px;margin-top:12px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--text2)}
.stats span{display:flex;align-items:center;gap:5px}
.stats .dot{width:6px;height:6px;border-radius:50%}
.stats .dot-dir{background:var(--accent)}.stats .dot-file{background:var(--green)}.stats .dot-size{background:var(--purple)}
table{width:100%;border-collapse:collapse;margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
thead th{padding:10px 14px;text-align:left;font-size:10px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--border);background:var(--surface2)}
thead th.r{text-align:right}
tbody tr{transition:background 0.15s}tbody tr:hover{background:var(--surface2)}
tbody td{padding:8px 14px;font-size:13px;border-bottom:1px solid rgba(34,34,51,0.5)}
tbody tr:last-child td{border-bottom:none}
.icon{width:28px;text-align:center}.icon svg{width:16px;height:16px;vertical-align:middle}
.name a{color:var(--text);text-decoration:none;font-weight:500}.name a:hover{color:var(--accent)}
.name .dir-a{color:var(--accent)}
.name .hidden-f{opacity:0.45}
.sz{text-align:right;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums}
.mod{text-align:right;font-size:11px;color:var(--text2)}
.footer{margin-top:20px;padding:12px 0;border-top:1px solid var(--border);font-size:11px;color:var(--text2);display:flex;justify-content:space-between;align-items:center}
.badge{display:inline-block;font-size:9px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:0.04em}
.badge-cfg{background:rgba(251,191,36,0.12);color:var(--amber)}
.badge-bin{background:rgba(167,139,250,0.12);color:var(--purple)}
.badge-log{background:rgba(200,200,216,0.08);color:var(--text2)}
</style>
</head>
<body>
<div class="wrap">
<div class="header">
<h1>` + phIcon(phHardDrive, "var(--accent)", "width:16px;height:16px;vertical-align:-2px;margin-right:6px") + `File Server</h1>
<div class="breadcrumb">`)

	// Breadcrumb navigation
	b.WriteString(`<a href="/">/</a>`)
	segments := strings.Split(strings.Trim(urlPath, "/"), "/")
	crumbPath := "/"
	for _, seg := range segments {
		if seg == "" {
			continue
		}
		crumbPath += seg + "/"
		b.WriteString(fmt.Sprintf(`<span class="sep">/</span><a href="%s">%s</a>`, htmlEsc(crumbPath), htmlEsc(seg)))
	}
	b.WriteString(`</div>`)

	// Stats bar
	dirPlural := "ies"
	if dirCount == 1 {
		dirPlural = "y"
	}
	filePlural := "s"
	if fileCount == 1 {
		filePlural = ""
	}
	b.WriteString(fmt.Sprintf(
		`<div class="stats"><span><span class="dot dot-dir"></span>%d director%s</span><span><span class="dot dot-file"></span>%d file%s</span><span><span class="dot dot-size"></span>%s total</span></div>`,
		dirCount, dirPlural, fileCount, filePlural, formatFileSize(totalSize),
	))
	b.WriteString(`</div>`)

	// Table
	b.WriteString(`<table><thead><tr><th style="width:36px"></th><th>Name</th><th style="width:70px" class="r">Size</th><th style="width:130px" class="r">Modified</th></tr></thead><tbody>`)

	if urlPath != "/" {
		b.WriteString(fmt.Sprintf(
			`<tr><td class="icon">%s</td><td class="name"><a href=".." class="dir-a">..</a></td><td></td><td></td></tr>`,
			phIcon(phArrowBendUpLeft, "var(--accent)", ""),
		))
	}

	for _, entry := range entries {
		isHidden := strings.HasPrefix(entry.Name, ".")

		var icon, iconColor string
		if entry.IsDir {
			icon = phFolder
			iconColor = "var(--accent)"
		} else {
			icon, iconColor = fileIconForExtGo(entry.Name)
		}

		display := entry.Name
		href := url.PathEscape(entry.Name)
		if entry.IsDir {
			display += "/"
			href += "/"
		}

		sizeStr := ""
		if !entry.IsDir {
			sizeStr = formatFileSize(entry.Size)
		}

		modStr := entry.ModTime.Format("Jan 02, 15:04")

		linkClass := ""
		if entry.IsDir {
			linkClass = "dir-a"
		} else if isHidden {
			linkClass = "hidden-f"
		}

		badge := fileBadgeGo(entry.Name, entry.IsDir)

		b.WriteString(fmt.Sprintf(
			`<tr><td class="icon">%s</td><td class="name"><a href="%s" class="%s">%s</a>%s</td><td class="sz">%s</td><td class="mod">%s</td></tr>`,
			phIcon(icon, iconColor, ""),
			htmlEsc(href), linkClass, htmlEsc(display),
			badge, sizeStr, modStr,
		))
	}

	b.WriteString(`</tbody></table>`)

	// Footer
	b.WriteString(fmt.Sprintf(
		`<div class="footer"><span>Served by SIPalyzer File Server</span><span>%d items</span></div></div></body></html>`,
		len(entries),
	))

	return b.String()
}

func htmlEsc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

func phIcon(pathD, color, style string) string {
	styleAttr := ""
	if style != "" {
		styleAttr = ` style="` + style + `"`
	}
	return fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="%s"%s><path d="%s"/></svg>`,
		color, styleAttr, pathD,
	)
}

func formatFileSize(bytes int64) string {
	if bytes >= 1<<30 {
		return fmt.Sprintf("%.1f GB", float64(bytes)/float64(1<<30))
	}
	if bytes >= 1<<20 {
		return fmt.Sprintf("%.1f MB", float64(bytes)/float64(1<<20))
	}
	if bytes >= 1<<10 {
		return fmt.Sprintf("%.1f KB", float64(bytes)/float64(1<<10))
	}
	return fmt.Sprintf("%d B", bytes)
}

// Phosphor Icons (Regular weight, 256x256 viewBox) — SVG path data
const (
	phFolder          = "M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V56H92.69l29.65,29.66A8,8,0,0,0,128,88h88Z"
	phFile            = "M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"
	phFileText        = "M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z"
	phGear            = "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.68l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187.11,168a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14A8,8,0,0,0,173.23,182l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.67a73.68,73.68,0,0,1-8.67,0,8,8,0,0,0-5.69,1.74l-17.73,14.19a91.57,91.57,0,0,1-15-6.23L82.77,182a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14A8,8,0,0,0,68.89,168l-22.58-2.51a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.67,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.68L40.08,94.93a91.57,91.57,0,0,1,6.23-15L68.89,82.77A8,8,0,0,0,74,80.13a74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.77,68.89l2.51-22.58a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.68,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.68-1.74l17.73-14.19a91.57,91.57,0,0,1,15,6.23L173.23,68.89a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.9,123.66Z"
	phHardDrive       = "M224,64H32A16,16,0,0,0,16,80v96a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64Zm0,112H32V80H224v96Zm-40-48a12,12,0,1,1-12-12A12,12,0,0,1,184,128Z"
	phTerminal        = "M117.31,134l-72,64a8,8,0,1,1-10.63-12L100,128,34.69,70A8,8,0,1,1,45.31,58l72,64a8,8,0,0,1,0,12ZM216,184H120a8,8,0,0,0,0,16h96a8,8,0,0,0,0-16Z"
	phPackage         = "M223.68,66.15,135.68,18a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32l80.34,44-29.77,16.3-80.35-44ZM128,120,47.66,76l33.9-18.56,80.34,44ZM40,90l80,43.78v85.79L40,175.82Zm96,129.57V133.82L216,90v85.78Z"
	phImage           = "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z"
	phGlobe           = "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.56,87.56,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.56,87.56,0,0,1,216,128ZM40,128a87.56,87.56,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.56,87.56,0,0,1,40,128Zm16.35-40H94.3a143.31,143.31,0,0,0-13.14,0h0A88.29,88.29,0,0,1,56.35,88Zm41.48,0h60.34C151.31,69.06,140.3,54.48,128,45.74,115.7,54.48,104.69,69.06,97.83,88Zm60.34,80H97.83c6.86,18.94,17.87,33.52,30.17,42.26C140.3,201.52,151.31,186.94,158.17,168Zm41.48,0H161.7a143.31,143.31,0,0,0,13.14-30.5A88.29,88.29,0,0,1,199.65,168ZM97.92,104h60.16a141.52,141.52,0,0,1,0,48H97.92a141.52,141.52,0,0,1,0-48Z"
	phMusicNote       = "M210.3,56.34l-80-24A8,8,0,0,0,120,40V148.26A48,48,0,1,0,136,184V50.75l69.7,20.91a8,8,0,1,0,4.6-15.32ZM88,216a32,32,0,1,1,32-32A32,32,0,0,1,88,216Z"
	phVideo           = "M164,128a36,36,0,1,1-36-36A36,36,0,0,1,164,128Zm68-56V184a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V72A16,16,0,0,1,40,56H216A16,16,0,0,1,232,72ZM216,184V72H40V184H216Zm-88-56a20,20,0,1,0-20,20A20,20,0,0,0,128,128Z"
	phFilePdf         = "M224,152a8,8,0,0,1-8,8H192v16h16a8,8,0,0,1,0,16H192v16a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8h32A8,8,0,0,1,224,152ZM92,172a28,28,0,0,1-28,28H56v8a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8H64A28,28,0,0,1,92,172Zm-16,0a12,12,0,0,0-12-12H56v24h8A12,12,0,0,0,76,172Zm88,0a36,36,0,0,1-36,36H112a8,8,0,0,1-8-8V152a8,8,0,0,1,8-8h16A36,36,0,0,1,164,172Zm-16,0a20,20,0,0,0-20-20h-8v40h8A20,20,0,0,0,148,172ZM40,112V40A16,16,0,0,1,56,24h96a8,8,0,0,1,5.66,2.34l56,56A8,8,0,0,1,216,88v24a8,8,0,0,1-16,0V96H152a8,8,0,0,1-8-8V40H56v72a8,8,0,0,1-16,0ZM160,80h28.69L160,51.31Z"
	phTable           = "M224,48H32A8,8,0,0,0,24,56V200a8,8,0,0,0,8,8H224a8,8,0,0,0,8-8V56A8,8,0,0,0,224,48ZM40,112h40v32H40Zm56,0H216v32H96Zm120-8H96V64H216ZM80,64v40H40V64ZM40,160H80v32H40Zm56,32V160H216v32Z"
	phArrowBendUpLeft = "M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L51.31,96H128A104.11,104.11,0,0,1,232,200Z"
)

func fileIconForExtGo(name string) (pathD, color string) {
	ext := strings.ToLower(filepath.Ext(name))
	ext = strings.TrimPrefix(ext, ".")
	switch ext {
	case "cfg", "conf", "ini", "yaml", "yml", "xml", "json", "toml":
		return phGear, "var(--amber)"
	case "bin", "fw", "img", "rom", "iso":
		return phHardDrive, "var(--purple)"
	case "log", "txt":
		return phFileText, "var(--text2)"
	case "sh", "bash", "py", "rb", "pl":
		return phTerminal, "var(--green)"
	case "tar", "gz", "zip", "tgz", "bz2", "xz", "7z":
		return phPackage, "var(--purple)"
	case "png", "jpg", "jpeg", "gif", "svg", "ico", "webp":
		return phImage, "var(--green)"
	case "pdf":
		return phFilePdf, "var(--red)"
	case "html", "htm", "css", "js":
		return phGlobe, "var(--accent)"
	case "csv", "tsv":
		return phTable, "var(--green)"
	case "wav", "mp3", "ogg", "flac":
		return phMusicNote, "var(--amber)"
	case "mp4", "mkv", "avi", "mov":
		return phVideo, "var(--purple)"
	default:
		return phFile, "var(--text2)"
	}
}

func fileBadgeGo(name string, isDir bool) string {
	if isDir {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(name))
	ext = strings.TrimPrefix(ext, ".")
	switch ext {
	case "cfg", "conf", "ini", "yaml", "yml", "xml", "json", "toml":
		return ` <span class="badge badge-cfg">config</span>`
	case "bin", "fw", "img", "rom", "iso":
		return ` <span class="badge badge-bin">firmware</span>`
	case "log", "txt":
		return ` <span class="badge badge-log">log</span>`
	default:
		return ""
	}
}

