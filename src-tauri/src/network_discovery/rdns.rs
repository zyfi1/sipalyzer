//! Reverse DNS lookup — resolves IP addresses to hostnames via PTR records.

use std::net::IpAddr;
use std::time::Duration;

/// Perform a reverse DNS lookup for a single IP address.
/// Returns `None` if no PTR record exists or the lookup times out.
pub async fn reverse_lookup(ip: IpAddr) -> Option<String> {
    match tokio::time::timeout(
        Duration::from_secs(3),
        tokio::net::lookup_host(format!("{}:0", ip)),
    )
    .await
    {
        Ok(Ok(_)) => {
            // tokio::net::lookup_host goes forward; we need reverse.
            // Use hickory-resolver for PTR lookup.
            reverse_lookup_ptr(ip).await
        }
        _ => None,
    }
}

/// Use hickory-resolver to perform a PTR lookup.
async fn reverse_lookup_ptr(ip: IpAddr) -> Option<String> {
    use hickory_resolver::config::*;
    use hickory_resolver::name_server::TokioConnectionProvider;
    use hickory_resolver::Resolver;

    let mut opts = ResolverOpts::default();
    opts.timeout = Duration::from_secs(2);
    opts.attempts = 1;

    let resolver = Resolver::builder_with_config(
        ResolverConfig::default(),
        TokioConnectionProvider::default(),
    )
    .with_options(opts)
    .build();

    match tokio::time::timeout(Duration::from_secs(3), resolver.reverse_lookup(ip)).await {
        Ok(Ok(lookup)) => lookup
            .iter()
            .next()
            .map(|name| name.to_string().trim_end_matches('.').to_string()),
        _ => None,
    }
}

/// Batch reverse DNS lookup for multiple IPs with concurrency control.
pub async fn batch_reverse_lookup(
    ips: &[IpAddr],
    concurrency: usize,
) -> Vec<(IpAddr, Option<String>)> {
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let mut handles = Vec::new();

    for &ip in ips {
        let sem = semaphore.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            let hostname = reverse_lookup(ip).await;
            (ip, hostname)
        }));
    }

    let mut results = Vec::new();
    for h in handles {
        if let Ok(result) = h.await {
            results.push(result);
        }
    }
    results
}
