//! SIP stack aligned with RFC 3261 and related.
//! - **stack**: Message format (CRLF, Content-Length, case-insensitive headers, header folding).
//! - **uri**: Request-URI and To/From/Contact (E.164, user escaping per RFC 3261).
//! - **auth**: Digest per RFC 2617 (HA1/HA2, Request-URI in uri, qop).

pub mod auth;
pub mod compat;
pub mod register;
pub mod stack;
pub mod tests;
pub mod transport;
pub mod uri;
