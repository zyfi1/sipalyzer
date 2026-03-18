/**
 * Extract autocomplete suggestions from wiki data for the request builder.
 * Provides header name suggestions, header value suggestions, and method suggestions.
 */

import { WIKI_SECTIONS } from "./crafterWikiData";

export interface Suggestion {
  text: string;
  description: string;
}

// ── Header name suggestions ──────────────────────────────────────────────────

function extractHeaders(protocol: "sip" | "http"): Suggestion[] {
  const results: Suggestion[] = [];
  const seen = new Set<string>();

  for (const section of WIKI_SECTIONS) {
    if (section.protocol !== protocol) continue;
    // Header sections
    if (
      section.id === "sip-headers" ||
      section.id === "http-headers" ||
      section.id === "http-headers-auth"
    ) {
      for (const entry of section.content) {
        if (entry.heading) continue;
        if (entry.insertTarget === "header" || entry.insertable) {
          const name = entry.text;
          const key = name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ text: name, description: entry.description });
          }
        }
      }
    }
  }

  return results;
}

const _sipHeaderSuggestions = extractHeaders("sip");
const _httpHeaderSuggestions = extractHeaders("http");

export function getHeaderSuggestions(protocol: "sip" | "http"): Suggestion[] {
  return protocol === "sip" ? _sipHeaderSuggestions : _httpHeaderSuggestions;
}

// ── Header value suggestions (keyed by header name) ──────────────────────────

interface ValueMap {
  [headerLower: string]: Suggestion[];
}

function buildValueMap(protocol: "sip" | "http"): ValueMap {
  const map: ValueMap = {};

  if (protocol === "sip") {
    map["content-type"] = [
      { text: "application/sdp", description: "SDP for media negotiation (INVITE, re-INVITE)" },
      { text: "application/dtmf-relay", description: "DTMF digit relay (INFO method)" },
      { text: "application/simple-message-summary", description: "Voicemail MWI (NOTIFY)" },
      { text: "application/pidf+xml", description: "Presence information (NOTIFY)" },
      { text: "application/dialog-info+xml", description: "Dialog state (BLF)" },
      { text: "application/xpidf+xml", description: "Extended presence" },
      { text: "text/plain", description: "Plain text (MESSAGE)" },
      { text: "text/html", description: "HTML content (MESSAGE)" },
      { text: "message/sipfrag", description: "SIP fragment (NOTIFY for REFER)" },
      { text: "multipart/mixed", description: "Multiple body parts" },
    ];
    map["event"] = [
      { text: "check-sync", description: "Polycom/Yealink config sync / reboot" },
      { text: "check-sync;reboot=true", description: "Yealink forced reboot" },
      { text: "message-summary", description: "MWI / voicemail notification" },
      { text: "presence", description: "User presence state" },
      { text: "dialog", description: "Dialog state (BLF)" },
      { text: "refer", description: "REFER progress events" },
      { text: "reg", description: "Registration state events" },
      { text: "keep-alive", description: "NAT keep-alive" },
      { text: "as-feature-event", description: "BroadWorks feature event" },
      { text: "line-seize", description: "Shared line seizure" },
    ];
    map["expires"] = [
      { text: "3600", description: "1 hour — typical registration" },
      { text: "7200", description: "2 hours" },
      { text: "1800", description: "30 minutes" },
      { text: "600", description: "10 minutes — short registration" },
      { text: "120", description: "2 minutes — very short" },
      { text: "0", description: "Unregister / unsubscribe" },
    ];
    map["max-forwards"] = [
      { text: "70", description: "Standard hop limit (RFC 3261)" },
    ];
    map["privacy"] = [
      { text: "none", description: "No privacy requested" },
      { text: "id", description: "Hide caller identity" },
      { text: "header", description: "Hide header values" },
      { text: "session", description: "Hide session info" },
      { text: "user", description: "Hide user info" },
      { text: "critical", description: "Privacy is critical — reject if not possible" },
    ];
    map["subscription-state"] = [
      { text: "active;expires=3600", description: "Subscription active, 1hr remaining" },
      { text: "pending", description: "Subscription pending approval" },
      { text: "terminated;reason=timeout", description: "Subscription ended (timeout)" },
      { text: "terminated;reason=deactivated", description: "Subscription deactivated" },
      { text: "terminated;reason=noresource", description: "Resource no longer exists" },
    ];
    map["accept"] = [
      { text: "application/sdp", description: "Accept SDP" },
      { text: "application/simple-message-summary", description: "Accept MWI" },
      { text: "application/pidf+xml", description: "Accept presence (PIDF)" },
      { text: "application/dialog-info+xml", description: "Accept dialog info" },
    ];
    map["user-agent"] = [
      { text: "SIPalyzer/1.0", description: "SIPalyzer default" },
    ];
    map["session-expires"] = [
      { text: "1800;refresher=uac", description: "30min, client refreshes" },
      { text: "1800;refresher=uas", description: "30min, server refreshes" },
      { text: "90;refresher=uac", description: "90s, client refreshes (minimum)" },
    ];
    map["min-se"] = [
      { text: "90", description: "Minimum session timer (90s default)" },
    ];
    map["reason"] = [
      { text: "Q.850;cause=16;text=\"Normal clearing\"", description: "Normal call hangup" },
      { text: "Q.850;cause=17;text=\"User busy\"", description: "User busy" },
      { text: "Q.850;cause=21;text=\"Call rejected\"", description: "Call rejected" },
      { text: "SIP;cause=200;text=\"Call completed\"", description: "SIP normal completion" },
      { text: "SIP;cause=480;text=\"Temporarily Unavailable\"", description: "User unavailable" },
      { text: "SIP;cause=487;text=\"Request Terminated\"", description: "Call cancelled" },
    ];
    map["supported"] = [
      { text: "100rel, timer, replaces, path, outbound", description: "Common supported extensions" },
      { text: "100rel", description: "Reliable provisional responses" },
      { text: "timer", description: "Session timers" },
      { text: "replaces", description: "Dialog replacement (attended transfer)" },
      { text: "path", description: "Path header support" },
      { text: "outbound", description: "Outbound connection reuse" },
    ];
    map["require"] = [
      { text: "100rel", description: "Require reliable provisional responses" },
      { text: "timer", description: "Require session timers" },
      { text: "replaces", description: "Require dialog replacement" },
    ];
    map["allow"] = [
      { text: "INVITE, ACK, BYE, CANCEL, OPTIONS, NOTIFY, REFER, SUBSCRIBE, INFO, UPDATE, PRACK, MESSAGE", description: "Full method set" },
      { text: "INVITE, ACK, BYE, CANCEL, OPTIONS", description: "Core methods only" },
    ];
    map["refer-to"] = [
      { text: "sip:target@example.com", description: "Transfer target URI" },
    ];
  }

  if (protocol === "http") {
    map["content-type"] = [
      { text: "application/json", description: "JSON body — most common for REST APIs" },
      { text: "application/x-www-form-urlencoded", description: "Form-encoded — default for HTML forms" },
      { text: "multipart/form-data", description: "File uploads, multi-part data" },
      { text: "text/plain", description: "Plain text" },
      { text: "text/html", description: "HTML content" },
      { text: "text/xml", description: "XML content" },
      { text: "application/xml", description: "XML content (preferred)" },
      { text: "application/octet-stream", description: "Binary / raw bytes" },
      { text: "application/graphql+json", description: "GraphQL request" },
      { text: "application/pdf", description: "PDF document" },
    ];
    map["accept"] = [
      { text: "application/json", description: "Expect JSON response" },
      { text: "*/*", description: "Accept anything" },
      { text: "text/html", description: "Expect HTML" },
      { text: "application/xml", description: "Expect XML" },
      { text: "text/html,application/json;q=0.9,*/*;q=0.8", description: "Prefer HTML, fallback JSON" },
    ];
    map["authorization"] = [
      { text: "Bearer ", description: "Bearer token (OAuth2, JWT)" },
      { text: "Basic ", description: "Basic auth (base64 user:pass)" },
    ];
    map["cache-control"] = [
      { text: "no-cache", description: "Revalidate before using cache" },
      { text: "no-store", description: "Don't cache at all" },
      { text: "max-age=3600", description: "Cache for 1 hour" },
      { text: "must-revalidate", description: "Must revalidate when stale" },
      { text: "no-cache, no-store, must-revalidate", description: "No caching whatsoever" },
    ];
    map["user-agent"] = [
      { text: "SIPalyzer/1.0", description: "SIPalyzer default" },
    ];
    map["origin"] = [
      { text: "http://localhost:3000", description: "Local dev server" },
      { text: "https://example.com", description: "Example origin" },
    ];
    map["x-requested-with"] = [
      { text: "XMLHttpRequest", description: "AJAX request indicator" },
    ];
    map["access-control-allow-origin"] = [
      { text: "*", description: "Allow all origins" },
    ];
    map["access-control-allow-methods"] = [
      { text: "GET, POST, PUT, PATCH, DELETE, OPTIONS", description: "Common CORS methods" },
    ];
    map["access-control-allow-headers"] = [
      { text: "Content-Type, Authorization, X-API-Key", description: "Common allowed headers" },
    ];
  }

  return map;
}

const _sipValueMap = buildValueMap("sip");
const _httpValueMap = buildValueMap("http");

export function getValueSuggestions(
  protocol: "sip" | "http",
  headerKey: string
): Suggestion[] {
  const map = protocol === "sip" ? _sipValueMap : _httpValueMap;
  return map[headerKey.toLowerCase()] ?? [];
}
