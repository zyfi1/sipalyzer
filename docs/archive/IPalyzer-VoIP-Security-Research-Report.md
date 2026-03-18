# SIPalyzer: VoIP Security Testing & SRTP/Encryption Analysis — Research Report

**Product context:** SIPalyzer is a desktop SIP/VoIP analysis tool. This report summarizes research on VoIP security testing tools, SRTP/encryption analysis, STIR/SHAKEN, toll fraud detection, compliance, and zero-trust security—with concrete feature ideas for SIPalyzer.

---

## 1. VoIP Security Testing Tools

### What Security Tools Offer

Leading tools focus on **discovery**, **enumeration**, **credential testing**, **flood/fuzzing**, and **reporting**, with support for multiple transports and CI/CD.

**SIPVicious (OSS & PRO):**
- **svmap** — Identify SIP devices and PBX servers on target networks ([Enable Security](https://www.enablesecurity.com/sipvicious/)).
- **svwar** — Extension scanner (guess extension ranges); **svcrack** — Password cracker for usernames/extensions; **svreport** — Report generation from scan results ([Enable Security](https://www.enablesecurity.com/sipvicious/)).
- PRO (internal only now) added: RFC-compliant SIP/RTP, high-speed flood with rate limiting, multiple attack types (SIP flood, RTP flood, enumeration, Digest leak, RTP Bleed, RTP inject), fuzzing (SIP, RTP, STIR/SHAKEN), templating, TCP/UDP/TLS/WebSockets, RTP attacks with SRTP/SSRC options, CI/CD (e.g. GitLab, Jenkins) ([SIPVicious PRO docs](https://docs.sipvicious.pro/stable/), [Enable Security blog](https://www.enablesecurity.com/blog/sipvicious-pro-with-various-fixes-and-gitlab-ci/)).

**Sippts (Kali):** SIP scanning, extension enumeration, password cracking, RTP bleed exploitation, SIP/RTP floods, protocol sniffing and spoofing ([Kali sippts](https://kali.org/tools/sippts)).

### SIPalyzer Feature Ideas — Security Testing

| Feature | Description |
|--------|-------------|
| **SIP device discovery (passive)** | From pcap: list SIP User-Agents, Contact hosts, Via domains, and detect PBX/carrier vs endpoint patterns. No active scanning—analysis only. |
| **Extension / user enumeration (passive)** | From captured REGISTER/INVITE/OPTIONS: infer valid extensions, usernames, and auth realms. Flag weak or default User-Agent/realms. |
| **Auth strength checker** | Report Digest vs no auth, weak/non-existent nonces, missing or weak integrity on signaling. |
| **Flood / abuse detection (passive)** | Detect high request rates (INVITE/REGISTER/OPTIONS), same Call-ID/From reuse, and request patterns typical of scanning or DoS in captured traffic. |
| **RFC compliance hints** | Flag malformed or non-compliant SIP (e.g. missing required headers, invalid CSeq, bad Via), with references to RFCs. |
| **SIP method usage report** | Per capture: which methods appear, frequency, and whether dangerous methods (REFER, INFO, etc.) are present and from where. |
| **Template / message builder** | Build or edit SIP messages (e.g. INVITE, REGISTER) from templates with placeholders for testing (export to file or replay in other tools). |

---

## 2. SRTP and Encryption Analysis

### How Engineers Debug Encrypted Media

- **SDES:** Keys are in SDP (e.g. `a=crypto:` in INVITE/200 OK). If SIP is in clear text, keys are plaintext; decryption is straightforward with the key + pcap ([Anthony Critelli](https://www.acritelli.com/blog/hacking-voip-decrypting-sdes-protected-srtp-phone-calls/), [Giacomo Vacca](https://www.giacomovacca.com/2025/03/decrypt-sdes-srtp-from-pcap.html)). **srtp-decrypt** is commonly used with keys extracted from SDP ([srtp-decrypt](https://github.com/gteissier/srtp-decrypt)).
- **TLS for SIP:** Decryption needs the server private key (only for non-PFS ciphers) or an SSL key log. With TLS 1.3/PFS, private-key decryption is not possible; key logging (e.g. `LD_PRELOAD` on PBX/SBC) is the practical approach ([VoIPmonitor TLS](https://www.voipmonitor.org/doc/Tls), [Atcom Systems](https://atcomsystems.ca/2023/03/31/extreme-voip-troubleshooting-decrypt-tls-sip-and-srtp/)).
- **DTLS-SRTP (e.g. WebRTC):** VoIPmonitor supports private key, SSL key logger, SBC tunneling, and external key providers ([VoIPmonitor](https://www.voipmonitor.org/), [WebRTC doc](https://www.voipmonitor.org/doc/WebRTC)). Wireshark + srtp-decrypt is used for manual SRTP from decrypted signaling ([Zoiper](https://zoiper.com/en/support/home/article/162/How%20to%20decode%20SIP%20over%20TLS%20with%20Wireshark%20and%20Decrypting%20SDES%20Protected%20SRTP%20Stream)).

There is no prominent standalone “Odin” tool for SDES in the results; SDES decryption is done via SDP key extraction + srtp-decrypt.

### SIPalyzer Feature Ideas — SRTP/Encryption

| Feature | Description |
|--------|-------------|
| **SDP crypto extractor** | Parse SDP in INVITE/200 OK, list all `a=crypto:` lines, show key/suite and which leg (caller/callee). One-click copy for srtp-decrypt or external decryption. |
| **SDES risk report** | If SIP is captured in cleartext and SDP contains crypto keys: flag “SDES keys in cleartext” and reference RFC 4568. Optionally show which RTP streams are decryptable. |
| **Encryption summary** | Per call/session: TLS vs UDP/TCP for signaling; SDES vs DTLS-SRTP vs none for media; cipher suite if visible. |
| **Key exchange method** | Classify as SDES (inline in SDP), DTLS-SRTP (handshake in RTP port), or unknown. |
| **Integration with srtp-decrypt** | Optional: run srtp-decrypt (if on PATH) with extracted key and selected stream, then open decrypted RTP/audio in SIPalyzer or export WAV. |
| **TLS key log support** | If user provides SSL key log (e.g. from PBX): decrypt TLS SIP and show decrypted SDP/crypto for SRTP. |
| **DTLS-SRTP presence** | Detect DTLS handshake associated with RTP and report “DTLS-SRTP in use” with fingerprint/cipher if available. |

---

## 3. STIR/SHAKEN Implementation

### STIR/SHAKEN Basics

- **STIR/SHAKEN** uses **PASSporT** tokens (JWTs) in the SIP **Identity** header to attest caller identity; attestation levels A/B/C indicate how much the originating provider vouches for the number ([RFC 8588](https://rfc-editor.org/rfc/rfc8588.html), [TransUnion](https://www.transunion.com/blog/what-are-the-attestation-levels-for-stir-shaken)).
- **Verification:** Validators check the JWT signature and use the **info** (x5u) URL to fetch the signing certificate ([DIDWW](https://doc.didww.com/voice/inbound-trunks/technical-data/stir-shaken.html)). Results are often reflected in headers like **P-Stir-Verstat** (e.g. TN-Validation-Passed, TN-Validation-Failed, No-TN-Validation) ([DIDWW](https://doc.didww.com/voice/inbound-trunks/technical-data/stir-shaken.html)).
- **JWT structure:** Identity header = three Base64Url parts (header, payload, signature); plus parameters such as **info**, **alg** (e.g. ES256), **ppt** (e.g. shaken) ([VoIP Nuggets](https://voipnuggets.com/2023/07/22/stir-shaken-understanding-the-sip-identity-header/)).

### Existing Analysis Capabilities

- **Sansay Identity Header Decoder:** Signature and certificate validation, certificate URL extraction, timestamp conversion, header/payload validation; helps with invalid signature and key/certificate mismatch ([Sansay decoder](https://support.sansay.com/t/60hctx8/stirshaken-identity-header-decoder), [Sansay troubleshooting](https://support.sansay.com/t/35hfntb/troubleshooting-stirshaken)).
- **Kamailio stirshaken:** Functions such as `stirshaken_check_identity()`, cert path validation per ATIS, and PASSporT generation ([Kamailio stirshaken](https://www.kamailio.org/docs/modules/5.6.x/modules/stirshaken.html)).
- **TransNexus:** STI-CPS and PASSporT handling; JWT bearer tokens with attestation, origination/destination, and integrity ([TransNexus PASSporT](https://transnexus.com/blog/2020/passports), [TransNexus CPS](https://cps.transnexus.com/)).
- **IDT Express:** STIR/SHAKEN verification service ([IDT Express](https://www.idtexpress.com/tools/stir-shaken/)).

### SIPalyzer Feature Ideas — STIR/SHAKEN

| Feature | Description |
|--------|-------------|
| **Identity header decoder** | Decode Identity header JWT (header + payload + signature), show alg, ppt, x5u/info, and human-readable payload (attestation, orig/dest TN, origid, iat, etc.). |
| **PASSporT payload viewer** | Structured view of PASSporT claims: attestation level (A/B/C), orig, dest, origid, and any custom claims. |
| **Certificate URL (x5u) extractor** | List x5u URLs from Identity headers; optional “fetch certificate” to download and show subject/issuer/validity. |
| **Signature verification** | Verify JWT signature using cert from x5u (or user-provided cert); report Valid / Invalid / Cannot verify (e.g. network/cert error). |
| **P-Stir-Verstat / Verstat parser** | Parse and display verification result (TN-Validation-Passed, TN-Validation-Failed, No-TN-Validation) when present. |
| **Attestation level report** | Per call: attestation level and short explanation (A = full, B/C = partial/none). |
| **STIR/SHAKEN call summary** | For each call: Identity present/absent, attestation, verification result, and any verification failure reason. |

---

## 4. Toll Fraud and Abuse Detection

### Attack Patterns and Detection

- **Registration attacks:** Hijacking or brute-forcing REGISTER to take over accounts ([IFIP](https://dl.ifip.org/db/conf/networking/networking2014/AzizHRD14.pdf), [Gonski Cyber](https://blog.gonskicyber.com/a-real-world-analysis-of-security-risks-in-telephony-systems)).
- **Extension brute force:** Large-scale REGISTER/OPTIONS/INVITE scanning (e.g. 822M+ attempts observed) ([Networking 2021](https://dl.ifip.org/db/conf/networking/networking2021/1570698735.pdf)).
- **Multi-stage:** Probe with INVITE/REGISTER/OPTIONS, then credential attacks, then toll abuse ([Gonski Cyber](https://blog.gonskicyber.com/a-real-world-analysis-of-security-risks-in-telephony-systems)).

Frameworks use **distributed sensors**, **rule-based detection**, **CDR analytics** (statistics + AI), **flow-based** application-aware monitoring, and **alarm correlation** ([IFIP](https://dl.ifip.org/db/conf/networking/networking2014/AzizHRD14.pdf), [SUNSHINE framework](https://lef.wiwi.uni-due.de/fileadmin/fileupload/I-TDR/Forschung/A_Comprehensive_Framework_for_Detecting_and_Preventing_VoIP_Fraud_and_Misuse.pdf), [SCISpace](https://scispace.com/papers/using-application-aware-flow-monitoring-for-sip-fraud-32scedsfu8)). CDR-based real-time analysis can target illegal termination, international revenue share fraud, account sharing, and policy abuse ([UOM](https://dl.lib.uom.lk/items/d5f9f86a-2ab3-40d9-bfce-5dc203ae31fe)).

### SIPalyzer Feature Ideas — Toll Fraud / Abuse

| Feature | Description |
|--------|-------------|
| **Registration anomaly detection** | From pcap: count REGISTER by client IP/user; flag high failure rate, many distinct users from one IP, or rapid succession of REGISTERs. |
| **Extension scan detection** | Detect OPTIONS/INVITE/REGISTER patterns (e.g. sequential or block extension probing) and list suspected scanner IPs. |
| **Toll / destination report** | From INVITE/200 OK: list Request-URI and To numbers; flag premium/short codes or country codes often used in toll fraud. |
| **Call volume by user / IP** | Per user or IP: call count, duration estimate, unique destinations; flag unusually high volume or burst. |
| **Failed auth dashboard** | 401/407 responses and retries; flag brute-force or password-spray patterns. |
| **Wangiri / callback pattern** | Short-duration calls (e.g. single ring) from many distinct sources to same destination or user. |
| **Geo / number consistency** | Optional: compare From/Contact/Request-URI with geo or numbering plan; flag mismatches that could indicate spoofing or abuse. |

---

## 5. Compliance and Regulatory

### FCC and HIPAA

- **FCC:** Interconnected VoIP providers must comply with **CPNI** rules (protection of call detail, location, services). Annual CPNI certifications; penalties up to **$220,213 per violation or per day** ([FCC DA-22-117](https://docs.fcc.gov/public/attachments/DA-22-117A1.pdf)). General interconnected VoIP rules also apply ([CommLaw Group](https://commlawgroup.com/compliance-resources/voip-compliance-guide/)).
- **HIPAA:** Voice carrying **PHI** is **ePHI**. Privacy, Security, and Breach Notification rules apply; BAAs with VoIP providers; documentation and HIPAA-compliant operations ([NCTRC](https://telehealthresourcecenter.org/news/voip-and-hipaa/), [HHS](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/hipaa-audio-telehealth/index.html), [ClearlyIP](https://go.clearlyip.com/articles/hipaa-telecommunications-compliance)).

### SIPalyzer Feature Ideas — Compliance

| Feature | Description |
|--------|-------------|
| **Encryption compliance report** | Per capture: TLS for signaling (Y/N), SRTP for media (Y/N); pass/fail vs “encryption required” policy (e.g. HIPAA/FCC guidance). |
| **CPNI exposure check** | List SIP headers and SDP fields that may contain CPNI (Call-ID, From, To, Contact, CSeq, dialed digits, etc.); support “sensitive fields” checklist for compliance review. |
| **HIPAA-oriented checklist** | Checklist: encryption in transit, access controls (auth), audit trail (logs), BAA considerations; export as report. |
| **Audit trail export** | Export call/session list with timestamps, parties, duration, and encryption/STIR status for compliance audits. |
| **Regulatory tags** | Tag captures or sessions with regulatory context (e.g. “HIPAA scope”, “CPNI”) and filter/report by tag. |

---

## 6. Zero-Trust and Modern Security

### Zero-Trust and SIP TLS

- **Zero Trust:** Verify every access; no implicit trust by location ([NSA](https://nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/4378980/nsa-releases-first-in-series-of-zero-trust-implementation-guidelines), [NIST NCCoE](https://nccoe.nist.gov/projects/implementing-zero-trust-architecture)).
- **SIP TLS:** TLS over TCP for signaling; TLS 1.2/1.3, CA-signed certs, CRL/OCSP; **mutual TLS** with client cert validation (CN/SAN) ([Cisco CUBE](https://www.cisco.com/c/en/us/support/docs/unified-communications/unified-border-element/220380-cisco-guide-to-harden-cisco-unified-bord.html), [Cisco SIP TLS](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/voice/cube/ios-xe/config/ios-xe-book/m_sip_tls_support_cube.pdf), [3CX](https://3cx.com/docs/secure-sip)).
- **VoIP segmentation:** Voice on dedicated VLANs; treat voice/data boundary as untrusted; SBCs at border; TLS + SRTP + strong auth ([NSA UC guide](https://publications.bsafes.com/docs/nsa/deploying-secure-unified-communications-voice-and-video-over-ip-systems-2), [TelcoSec](https://www.telco-sec.com/voip-hacking), [Cisco CUCM](https://www.cisco.com/c/en/us/td/docs/voice_ip_comm/cucm/security/15_0/cucm_b_security-guide-release-15/cucm_m_trunk-and-gateway-sip-security_reog.html)).

### SIPalyzer Feature Ideas — Zero-Trust / Modern Security

| Feature | Description |
|--------|-------------|
| **TLS version & cipher report** | From TLS handshakes in capture: protocol (1.2/1.3), cipher suite, and whether mutual auth (client cert) was used. |
| **Certificate chain view** | For SIP TLS connections: show server (and if present client) cert chain, subject/issuer, validity, and basic CRL/OCSP note if available. |
| **Mutual auth indicator** | Per SIP dialog or connection: “server-only TLS” vs “mutual TLS” based on presence of client certificate. |
| **Clear-text SIP detector** | Flag any SIP over UDP or TCP without TLS; list endpoints and suggest “upgrade to TLS.” |
| **Segmentation / topology hints** | From IPs and VLAN tags (if present): group endpoints by subnet; suggest “voice vs data” grouping for segmentation review. |
| **Zero-trust checklist** | Checklist: TLS for signaling, SRTP for media, mutual auth, no cleartext SIP, strong auth; export as report. |

---

## Summary: High-Value Feature Clusters for SIPalyzer

1. **Encryption & keys:** SDP crypto extraction, SDES risk, encryption summary, optional srtp-decrypt and TLS key log support.  
2. **STIR/SHAKEN:** Identity/PASSporT decoder, x5u/cert fetch, signature verification, P-Stir-Verstat and attestation reporting.  
3. **Security testing (passive):** Discovery, enumeration, auth strength, flood/abuse detection, RFC compliance hints, method usage.  
4. **Fraud/abuse:** Registration and extension-scan detection, toll/destination report, volume and failed-auth dashboards, wangiri and geo consistency.  
5. **Compliance:** Encryption/CPNI/HIPAA-oriented reports, audit export, regulatory tags.  
6. **Zero-trust:** TLS version/cipher and mutual-auth reporting, cleartext SIP detection, segmentation hints, zero-trust checklist.

---

## Sources

- [Anthony Critelli – Hacking VoIP: Decrypting SDES Protected SRTP](https://www.acritelli.com/blog/hacking-voip-decrypting-sdes-protected-srtp-phone-calls/)
- [Atcom Systems – Extreme VoIP Troubleshooting (TLS/SRTP)](https://atcomsystems.ca/2023/03/31/extreme-voip-troubleshooting-decrypt-tls-sip-and-srtp/)
- [Cisco – Harden CUBE](https://www.cisco.com/c/en/us/support/docs/unified-communications/unified-border-element/220380-cisco-guide-to-harden-cisco-unified-bord.html)
- [Cisco – SIP TLS Support CUBE](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/voice/cube/ios-xe/config/ios-xe-book/m_sip_tls_support_cube.pdf)
- [Cisco – CUCM Trunk and Gateway SIP Security](https://www.cisco.com/c/en/us/td/docs/voice_ip_comm/cucm/security/15_0/cucm_b_security-guide-release-15/cucm_m_trunk-and-gateway-sip-security_reog.html)
- [CommLaw Group – VoIP Compliance Guide](https://commlawgroup.com/compliance-resources/voip-compliance-guide/)
- [DIDWW – STIR/SHAKEN](https://doc.didww.com/voice/inbound-trunks/technical-data/stir-shaken.html)
- [Enable Security – SIPVicious OSS](https://www.enablesecurity.com/sipvicious/)
- [Enable Security – SIPVicious PRO blog](https://www.enablesecurity.com/blog/sipvicious-pro-with-various-fixes-and-gitlab-ci/)
- [FCC DA-22-117 (CPNI)](https://docs.fcc.gov/public/attachments/DA-22-117A1.pdf)
- [Giacomo Vacca – Decrypt SDES SRTP from pcap](https://www.giacomovacca.com/2025/03/decrypt-sdes-srtp-from-pcap.html)
- [Gonski Cyber – Real-World Toll Fraud Analysis](https://blog.gonskicyber.com/a-real-world-analysis-of-security-risks-in-telephony-systems)
- [HHS – HIPAA Audio-Only Telehealth](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/hipaa-audio-telehealth/index.html)
- [IDT Express – STIR/SHAKEN Verification](https://www.idtexpress.com/tools/stir-shaken/)
- [IFIP Networking 2014 – SIP attacks](https://dl.ifip.org/db/conf/networking/networking2014/AzizHRD14.pdf)
- [Kali – sippts](https://kali.org/tools/sippts)
- [Kamailio – stirshaken module](https://www.kamailio.org/docs/modules/5.6.x/modules/stirshaken.html)
- [NCTRC – VoIP and HIPAA](https://telehealthresourcecenter.org/news/voip-and-hipaa/)
- [NSA – Zero Trust Guidelines](https://nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/4378980/nsa-releases-first-in-series-of-zero-trust-implementation-guidelines)
- [NIST NCCoE – Implementing Zero Trust](https://nccoe.nist.gov/projects/implementing-zero-trust-architecture)
- [NSA – Deploying Secure UC/VoIP](https://publications.bsafes.com/docs/nsa/deploying-secure-unified-communications-voice-and-video-over-ip-systems-2)
- [RFC 8588 – PASSporT for SHAKEN](https://rfc-editor.org/rfc/rfc8588.html)
- [Sansay – Identity Header Decoder](https://support.sansay.com/t/60hctx8/stirshaken-identity-header-decoder)
- [Sansay – Troubleshooting STIR/SHAKEN](https://support.sansay.com/t/35hfntb/troubleshooting-stirshaken)
- [SIPVicious PRO – Docs](https://docs.sipvicious.pro/stable/)
- [SCISpace – Application-Aware Flow Monitoring for SIP Fraud](https://scispace.com/papers/using-application-aware-flow-monitoring-for-sip-fraud-32scedsfu8)
- [Simplicity VoIP – Ultimate VoIP Security Checklist](https://blog.simplicityvoip.net/the-ultimate-voip-security-checklist)
- [TelcoSec – VoIP Security & Penetration Testing](https://www.telco-sec.com/voip-hacking)
- [TransNexus – PASSporTs with STIR/SHAKEN](https://transnexus.com/blog/2020/passports)
- [TransNexus – STI-CPS](https://cps.transnexus.com/)
- [TransUnion – STIR/SHAKEN Attestation Levels](https://www.transunion.com/blog/what-are-the-attestation-levels-for-stir-shaken)
- [UOM – Real-time fraud detection CDR](https://dl.lib.uom.lk/items/d5f9f86a-2ab3-40d9-bfce-5dc203ae31fe)
- [VoIP Nuggets – SIP Identity Header](https://voipnuggets.com/2023/07/22/stir-shaken-understanding-the-sip-identity-header/)
- [VoIPmonitor – TLS Decryption](https://www.voipmonitor.org/doc/Tls)
- [VoIPmonitor – WebRTC](https://www.voipmonitor.org/doc/WebRTC)
- [VoIPmonitor – Main](https://www.voipmonitor.org/)
- [3CX – Secure SIP TLS](https://3cx.com/docs/secure-sip)
- [Zoiper – Decode SIP over TLS and SDES SRTP with Wireshark](https://zoiper.com/en/support/home/article/162/How%20to%20decode%20SIP%20over%20TLS%20with%20Wireshark%20and%20Decrypting%20SDES%20Protected%20SRTP%20Stream)
- [ClearlyIP – HIPAA Telecommunications](https://go.clearlyip.com/articles/hipaa-telecommunications-compliance)
- [SUNSHINE framework – VoIP fraud (Uni DuE)](https://lef.wiwi.uni-due.de/fileadmin/fileupload/I-TDR/Forschung/A_Comprehensive_Framework_for_Detecting_and_Preventing_VoIP_Fraud_and_Misuse.pdf)
- [Networking 2021 – SIP scanning](https://dl.ifip.org/db/conf/networking/networking2021/1570698735.pdf)
