// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// One GET of <server>api/auth/status for the server screen. It reports what it
// saw and nothing more: the screen's connect.js decides what that means, so the
// rules live in one tested place (scripts/test-app.js).

use std::time::Duration;

use serde::Serialize;

const MAX_BODY: usize = 64 * 1024;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// HTTP status of the answer
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// the address that answered, after redirects
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// at most 64 KiB of the body, as text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// no answer: "tls", "connect", "timeout" or "other"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub async fn get(url: &str) -> Probe {
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(concat!("KiSiauThong-app/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(c) => c,
        Err(e) => return failed("other", &e),
    };
    let mut resp = match client.get(url).header(reqwest::header::ACCEPT, "application/json").send().await {
        Ok(r) => r,
        Err(e) => return failed(error_kind(&e), &e),
    };
    let mut p = Probe {
        status: Some(resp.status().as_u16()),
        final_url: Some(resp.url().to_string()),
        content_type: resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_owned),
        ..Probe::default()
    };
    let mut body = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(c)) => {
                body.extend_from_slice(&c);
                if body.len() >= MAX_BODY {
                    body.truncate(MAX_BODY);
                    break;
                }
            }
            Ok(None) => break,
            Err(e) => return failed(error_kind(&e), &e),
        }
    }
    p.body = Some(String::from_utf8_lossy(&body).into_owned());
    p
}

fn failed(kind: &'static str, e: &(dyn std::error::Error + 'static)) -> Probe {
    Probe { error: Some(kind), detail: Some(chain(e).join(": ")), ..Probe::default() }
}

/// Every message in an error's source chain.
fn chain(e: &(dyn std::error::Error + 'static)) -> Vec<String> {
    let mut out = vec![e.to_string()];
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push(s.to_string());
        cur = s.source();
    }
    out
}

fn error_kind(e: &reqwest::Error) -> &'static str {
    if e.is_timeout() {
        "timeout"
    } else if is_tls(&chain(e)[1..]) {
        // [1..]: reqwest's own message names the url, which may contain "tls" or "ssl"
        "tls"
    } else if e.is_connect() {
        "connect"
    } else {
        "other"
    }
}

/// Whether an error chain is a failed TLS handshake or certificate check, as
/// the system TLS libraries word it (Security.framework on Apple, SChannel on
/// Windows, OpenSSL or rustls elsewhere).
pub fn is_tls(chain: &[String]) -> bool {
    const SIGNS: &[&str] = &[
        "certificate",
        "x509",
        "tls",
        "ssl",
        "handshake",
        "not trusted",
        "untrusted",
        "unknownissuer",
        "unknown issuer",
        "osstatus -98", // Security.framework SSL errors are -9800 … -9899
        "trust evaluation",
    ];
    chain.iter().any(|m| {
        let m = m.to_lowercase();
        SIGNS.iter().any(|s| m.contains(s))
    })
}

#[cfg(test)]
mod tests {
    use super::is_tls;

    fn c(msgs: &[&str]) -> Vec<String> {
        msgs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tls_failures_are_told_apart_from_unreachable_servers() {
        assert!(is_tls(&c(&["error sending request", "client error (Connect)", "The certificate was not trusted."])));
        assert!(is_tls(&c(&["error sending request", "OSStatus -9813"])));
        assert!(is_tls(&c(&["error sending request", "error:0A000086:SSL routines::certificate verify failed"])));
        assert!(is_tls(&c(&["error sending request", "invalid peer certificate: UnknownIssuer"])));
        assert!(is_tls(&c(&["error sending request", "The certificate chain was issued by an authority that is not trusted."])));
        assert!(!is_tls(&c(&["error sending request", "client error (Connect)", "tcp connect error", "Connection refused (os error 61)"])));
        assert!(!is_tls(&c(&["error sending request", "dns error", "failed to lookup address information: nodename nor servname provided, or not known"])));
    }
}
