//! Core DNS resolver factory — builds async resolvers with optional custom server/transport.

use hickory_resolver::config::{
    NameServerConfig, NameServerConfigGroup, ResolveHosts, ResolverConfig, ResolverOpts,
};
use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::proto::xfer::Protocol;
use hickory_resolver::{Resolver, TokioResolver};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

/// DNS transport protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DnsTransport {
    Udp,
    Tcp,
}

/// Create a `TokioAsyncResolver` with optional custom DNS server.
///
/// - If `server` is `None`, uses the system default resolver.
/// - If `server` is `Some`, parses it as an IP address and builds a custom config
///   pointing at that server on the given port (default 53).
/// - `transport` controls UDP vs TCP (default UDP).
pub fn create_resolver(
    server: Option<&str>,
    port: Option<u16>,
    transport: Option<DnsTransport>,
) -> Result<TokioResolver, String> {
    let dns_port = port.unwrap_or(53);
    let proto = transport.unwrap_or(DnsTransport::Udp);

    match server {
        Some(server_str) => {
            let ip: IpAddr = server_str
                .parse()
                .map_err(|e| format!("Invalid DNS server IP '{}': {}", server_str, e))?;
            let socket = SocketAddr::new(ip, dns_port);

            let ns = match proto {
                DnsTransport::Udp => NameServerConfig::new(socket, Protocol::Udp),
                DnsTransport::Tcp => NameServerConfig::new(socket, Protocol::Tcp),
            };

            let mut group = NameServerConfigGroup::new();
            group.push(ns);

            // Also add TCP fallback if using UDP (for truncated responses)
            if proto == DnsTransport::Udp {
                group.push(NameServerConfig::new(socket, Protocol::Tcp));
            }

            let config = ResolverConfig::from_parts(None, vec![], group);

            let mut opts = ResolverOpts::default();
            opts.timeout = Duration::from_secs(5);
            opts.attempts = 2;
            opts.use_hosts_file = ResolveHosts::Never;
            opts.edns0 = true;

            Ok(
                Resolver::builder_with_config(config, TokioConnectionProvider::default())
                    .with_options(opts)
                    .build(),
            )
        }
        None => {
            let mut opts = ResolverOpts::default();
            opts.timeout = Duration::from_secs(5);
            opts.attempts = 2;
            opts.edns0 = true;

            Ok(Resolver::builder_with_config(
                ResolverConfig::default(),
                TokioConnectionProvider::default(),
            )
            .with_options(opts)
            .build())
        }
    }
}

/// Create a resolver with short timeouts for batch/fast operations.
pub fn create_fast_resolver(
    server: Option<&str>,
    port: Option<u16>,
) -> Result<TokioResolver, String> {
    let dns_port = port.unwrap_or(53);

    match server {
        Some(server_str) => {
            let ip: IpAddr = server_str
                .parse()
                .map_err(|e| format!("Invalid DNS server IP '{}': {}", server_str, e))?;
            let socket = SocketAddr::new(ip, dns_port);

            let ns = NameServerConfig::new(socket, Protocol::Udp);
            let mut group = NameServerConfigGroup::new();
            group.push(ns);

            let config = ResolverConfig::from_parts(None, vec![], group);

            let mut opts = ResolverOpts::default();
            opts.timeout = Duration::from_secs(2);
            opts.attempts = 1;
            opts.use_hosts_file = ResolveHosts::Never;

            Ok(
                Resolver::builder_with_config(config, TokioConnectionProvider::default())
                    .with_options(opts)
                    .build(),
            )
        }
        None => {
            let mut opts = ResolverOpts::default();
            opts.timeout = Duration::from_secs(2);
            opts.attempts = 1;

            Ok(Resolver::builder_with_config(
                ResolverConfig::default(),
                TokioConnectionProvider::default(),
            )
            .with_options(opts)
            .build())
        }
    }
}
