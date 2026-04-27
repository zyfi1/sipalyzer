package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func runSimpleFTP(ctx context.Context, serveDir, advertiseIP string, port uint16, ch chan<- ToolResponse, ready chan<- string) {
	absRoot, err := filepath.Abs(serveDir)
	if err != nil {
		log.Printf("[FileServe] FTP root: %v", err)
		absRoot = serveDir
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		log.Printf("[FileServe] FTP listen :%d: %v", port, err)
		if ready != nil {
			select {
			case ready <- "":
			default:
			}
		}
		return
	}

	localPort := uint16(ln.Addr().(*net.TCPAddr).Port)
	ip := advertiseIP
	if ip == "" {
		ip = "127.0.0.1"
	}
	ftpURL := fmt.Sprintf("ftp://%s:%d/", ip, localPort)

	if ready != nil {
		select {
		case ready <- ftpURL:
		default:
		}
	}

	ch <- ToolResponse{
		Type: "Progress",
		Data: ProgressData{
			Message: fmt.Sprintf("FTP serving %s", ftpURL),
			Partial: FileServeStatus{
				HttpURL: "",
				TftpURL: "",
				FtpURL:  ftpURL,
				Serving: true,
			},
		},
	}

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[FileServe] FTP accept: %v", err)
			return
		}
		go handleFTPClient(ctx, conn, absRoot, ip, ch)
	}
}

func ftpHasParentTraversal(p string) bool {
	return strings.Contains(filepath.ToSlash(p), "../")
}

func resolveFTPPath(rootAbs, cwdRel, arg string) (string, bool) {
	arg = strings.TrimSpace(arg)
	if arg == "" {
		return "", false
	}
	if ftpHasParentTraversal(arg) {
		return "", false
	}
	var joined string
	if strings.HasPrefix(arg, "/") {
		rel := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(arg)), "/")
		joined = filepath.Join(rootAbs, rel)
	} else {
		joined = filepath.Join(rootAbs, cwdRel, arg)
	}
	joined = filepath.Clean(joined)
	rel, err := filepath.Rel(rootAbs, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", false
	}
	return joined, true
}

func handleFTPClient(ctx context.Context, c net.Conn, rootAbs, advertiseIP string, ch chan<- ToolResponse) {
	defer c.Close()

	rd := bufio.NewReader(c)
	wr := bufio.NewWriter(c)
	writeLine := func(s string) {
		_, _ = fmt.Fprintf(wr, "%s\r\n", s)
		_ = wr.Flush()
	}

	cwdRel := ""
	loggedIn := false
	var pasvLn net.Listener

	writeLine("220 SIPalyzer EdgeMarc FTP (read-only, anonymous)")

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		_ = c.SetReadDeadline(time.Now().Add(3 * time.Minute))
		line, err := rd.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		upper := strings.ToUpper(line)

		if strings.HasPrefix(upper, "USER ") {
			writeLine("331 send password")
		} else if strings.HasPrefix(upper, "PASS ") {
			loggedIn = true
			writeLine("230 logged in")
		} else if upper == "SYST" {
			writeLine("215 UNIX Type: L8")
		} else if upper == "FEAT" {
			writeLine("211-Features:")
			writeLine(" SIZE")
			writeLine("211 end")
		} else if upper == "PWD" || upper == "XPWD" {
			p := "/" + strings.TrimLeft(filepath.ToSlash(cwdRel), "/")
			writeLine(fmt.Sprintf("257 \"%s\"", p))
		} else if strings.HasPrefix(upper, "CWD ") {
			arg := strings.TrimSpace(line[4:])
			if arg == "/" || arg == "" {
				cwdRel = ""
				writeLine("250 cwd ok")
			} else if p, ok := resolveFTPPath(rootAbs, cwdRel, arg); ok {
				st, err := os.Stat(p)
				if err == nil && st.IsDir() {
					rel, err := filepath.Rel(rootAbs, p)
					if err == nil {
						cwdRel = rel
						writeLine("250 cwd ok")
						continue
					}
				}
				writeLine("550 failed")
			} else {
				writeLine("550 failed")
			}
		} else if strings.HasPrefix(upper, "TYPE ") {
			writeLine("200 type set")
		} else if upper == "PASV" {
			pl, err := net.Listen("tcp", "0.0.0.0:0")
			if err != nil {
				writeLine("425 cannot open passive port")
				continue
			}
			if pasvLn != nil {
				_ = pasvLn.Close()
			}
			pasvLn = pl
			localPort := pl.Addr().(*net.TCPAddr).Port
			parsed := net.ParseIP(advertiseIP)
			ip4 := parsed.To4()
			if ip4 == nil {
				ip4 = net.IPv4(127, 0, 0, 1)
			}
			a, b, c, d := ip4[0], ip4[1], ip4[2], ip4[3]
			p1 := byte(localPort >> 8)
			p2 := byte(localPort & 0xff)
			writeLine(fmt.Sprintf("227 Entering Passive Mode (%d,%d,%d,%d,%d,%d)", a, b, c, d, p1, p2))
		} else if strings.HasPrefix(upper, "SIZE ") {
			if !loggedIn {
				writeLine("530 not logged in")
				continue
			}
			arg := strings.TrimSpace(line[5:])
			if p, ok := resolveFTPPath(rootAbs, cwdRel, arg); ok {
				if st, err := os.Stat(p); err == nil && !st.IsDir() {
					writeLine(fmt.Sprintf("213 %d", st.Size()))
					continue
				}
			}
			writeLine("550 file unavailable")
		} else if strings.HasPrefix(upper, "RETR ") {
			if !loggedIn {
				writeLine("530 not logged in")
				continue
			}
			arg := strings.TrimSpace(line[5:])
			path, ok := resolveFTPPath(rootAbs, cwdRel, arg)
			if !ok {
				writeLine("550 failed")
				continue
			}
			if pasvLn == nil {
				writeLine("425 use PASV first")
				continue
			}
			pl := pasvLn
			pasvLn = nil

			writeLine("150 opening binary connection")
			if tl, ok := pl.(*net.TCPListener); ok {
				_ = tl.SetDeadline(time.Now().Add(120 * time.Second))
			}
			dataSock, err := pl.Accept()
			_ = pl.Close()
			if err != nil {
				writeLine("426 transfer aborted")
				continue
			}

			f, err := os.Open(path)
			if err != nil {
				_ = dataSock.Close()
				writeLine("550 cannot read file")
				continue
			}
			start := time.Now()
			n, copyErr := io.Copy(dataSock, f)
			_ = f.Close()
			_ = dataSock.Close()
			duration := time.Since(start)

			req := FileServeRequest{
				Timestamp:  time.Now().Format(time.RFC3339),
				ClientIP:   c.RemoteAddr().String(),
				Filename:   arg,
				Status:     200,
				BytesSent:  uint64(n),
				DurationMs: uint64(duration.Milliseconds()),
				Protocol:   "ftp",
			}
			select {
			case ch <- ToolResponse{
				Type: "Progress",
				Data: ProgressData{
					Message: fmt.Sprintf("%s RETR %s", c.RemoteAddr().String(), arg),
					Partial: req,
				},
			}:
			default:
			}

			if copyErr != nil {
				writeLine("426 transfer failed")
			} else {
				writeLine("226 transfer complete")
			}
		} else if upper == "QUIT" {
			writeLine("221 bye")
			return
		} else if upper == "NOOP" {
			writeLine("200 ok")
		} else {
			writeLine("502 command not implemented")
		}
	}
}
