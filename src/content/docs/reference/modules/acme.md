---
title: ACME and Let's Encrypt
description: Automatically issue and renew TLS certificates inside nginz using the ACME HTTP-01 flow.
---

# ACME and Let's Encrypt

Use this module when you want nginx to own certificate issuance and renewal instead of depending on a separate certificate agent.

## When to use this module

- You terminate public HTTPS traffic in nginx and want certificates created where traffic actually lands.
- You want one operational flow for initial issuance and later renewal.
- You prefer a simple trigger-driven renewal model instead of a long-running certificate daemon.
- You need to serve HTTP-01 challenge responses directly from nginx.

## nginx.conf synthesis

Add the ACME settings in `http {}` and bind each certificate domain in the matching TLS `server {}` block.

```nginx
http {
    acme on;
    acme_email admin@example.com;
    acme_storage /etc/nginx/acme;

    server {
        listen 80;
        server_name example.com;

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name example.com;

        acme_domain example.com;
        proxy_pass http://backend;
    }
}
```

The module handles the HTTP-01 challenge path and uses the configured storage directory for account keys and issued certificates.

## Directive reference

### `acme`

- **Contexts:** `http`
- **Default:** `off`

Turns ACME management on for the nginx instance. Use this only when you want nginx to participate in certificate issuance and renewal.

### `acme_server`

- **Contexts:** `http`
- **Default:** Let's Encrypt production directory

Changes which ACME directory endpoint nginx talks to. Use it when you need a staging environment or a different ACME provider.

### `acme_staging`

- **Contexts:** `http`
- **Default:** `off`

Switches the flow to the staging server for safe testing. Use this before production cutover so you do not burn real issuance limits.

### `acme_email`

- **Contexts:** `http`
- **Default:** none

Sets the account contact email used when the ACME account is created. This is the operational contact for certificate issues.

### `acme_storage`

- **Contexts:** `http`
- **Default:** `/etc/nginx/acme`

Defines where account keys and certificate files are stored on disk. Pick a path with controlled permissions and predictable backup behavior.

### `acme_renew_before`

- **Contexts:** `http`
- **Default:** `30`

Tells the module how many days before expiry it should consider the certificate ready for renewal. Use a larger value if you want more operational cushion.

### `acme_domain`

- **Contexts:** `server`
- **Default:** none

Associates a TLS server block with the domain that should receive a certificate. This is what ties certificate management to the live virtual host.

## Works well with

- Stock nginx `ssl_certificate` and `ssl_certificate_key` — the ACME module places certificates where these directives expect them.
- **Request ID** for tracing trigger and renewal calls through logs.
- **Prometheus Metrics** for tracking whether the certificate management endpoints are being exercised as expected.
- **Health Checks** when you want HTTPS endpoints observed after certificate rollout.
