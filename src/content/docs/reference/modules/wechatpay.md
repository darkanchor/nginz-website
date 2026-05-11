---
title: WeChat Pay Gateway
description: Proxy module for the WeChat Pay gateway with request signing, response verification, notification signature verification, optional AES-GCM decryption, and RSA OAEP encryption/decryption handlers.
---

# WeChat Pay Gateway

Use this module when your application needs to communicate with the WeChat Pay API. It handles the signing and verification that the WeChat Pay gateway requires, so your backend code does not need to implement WeChat's specific cryptographic protocol.

## When to use this module

- You need to proxy requests to `api.mch.weixin.qq.com` with proper WeChat Pay request signing and response verification.
- You receive WeChat Pay notifications and need to verify their signatures (and optionally decrypt AES-GCM-256 encrypted payloads).
- You need RSA OAEP encryption or decryption of base64-encoded payloads using WeChat Pay keys.

## nginx.conf synthesis

```nginx
http {
    wechatpay_apiclient_key_file /etc/nginx/keys/prvkey.pem;
    wechatpay_public_key_file  /etc/nginx/keys/pubkey.pem;
    wechatpay_apiclient_serial 0000000000;
    wechatpay_serial FFFFFFFFFF;
    wechatpay_mch_id 1234567890;

    server {
        listen 443 ssl;

        # WeChat Pay notification verification
        location /notify {
            wechatpay_access "your-32-byte-aes-secret";
            proxy_pass http://localhost/confirm;
        }
    }

    server {
        listen 80;
        resolver 223.5.5.5;

        # Upstream proxy to WeChat Pay
        location / {
            wechatpay_proxy_pass https://api.mch.weixin.qq.com;
        }

        # RSA OAEP encrypt/decrypt handlers
        location /encrypt {
            wechatpay_oaep_encrypt on;
        }

        location /decrypt {
            wechatpay_oaep_decrypt on;
        }
    }

    server {
        listen 80;

        location /confirm {
            allow 127.0.0.1;
            deny all;
        }
    }
}
```

## How it works

The module provides three distinct capabilities:

**Gateway proxy.** `wechatpay_proxy_pass` acts like a standard `proxy_pass` but signs outgoing requests using your API client key and verifies WeChat Pay's signature on responses. It uses the original request method, URI path, and query arguments to compute the signature.

**Notification verification.** `wechatpay_access` runs in the access phase. It verifies the signature on incoming WeChat Pay notification requests and rejects invalid ones before they reach your backend. When an AES-GCM-256 secret is provided, it automatically decrypts encrypted fields in the notification body.

**OAEP crypto handlers.** `wechatpay_oaep_encrypt` and `wechatpay_oaep_decrypt` are standalone content handlers. Encrypt takes the request body, applies RSA PKCS1 OAEP padding with the configured public key, and returns base64-encoded ciphertext. Decrypt does the reverse using the private key.

## Directive reference

### `wechatpay_proxy_pass`

- **Contexts:** `location`
- **Default:** `http://wechatpay_gateway:80`

Proxies requests to the WeChat Pay upstream gateway with request signing and response verification. Unlike `proxy_pass`, this directive does not need `$request_uri` because the gateway uses the original URI to compute signatures.

### `wechatpay_apiclient_key_file`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Path to your API client private key PEM file. Used for signing outgoing requests and for OAEP decryption.

### `wechatpay_apiclient_serial`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Your API client certificate serial number used in signature computation.

### `wechatpay_public_key_file`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Path to the WeChat Pay platform public key PEM file. Used for verifying upstream response signatures and for OAEP encryption.

### `wechatpay_serial`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

The WeChat Pay platform certificate serial number (Public Key ID). Used to verify upstream signatures.

### `wechatpay_mch_id`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Your WeChat Pay merchant ID, used in signature computation.

### `wechatpay_oaep_encrypt`

- **Contexts:** `location`
- **Default:** `off`

When enabled, the location encrypts the request body using RSA PKCS1 OAEP padding with the public key from `wechatpay_public_key_file` and returns the base64-encoded ciphertext.

### `wechatpay_oaep_decrypt`

- **Contexts:** `location`
- **Default:** `off`

When enabled, the location decrypts the base64-encoded request body using the private key from `wechatpay_apiclient_key_file` with RSA PKCS1 OAEP padding and returns the plaintext.

### `wechatpay_access`

- **Contexts:** `location`
- **Default:** none

Enables WeChat Pay signature verification in the access phase. Takes an optional 32-byte AES-GCM-256 secret. When the secret is provided, the module locates and decrypts encrypted fields in the request body after signature verification succeeds. Requests that fail verification are rejected before reaching the content handler.

## Works well with

- [JWT Authentication](/docs/reference/modules/jwt) for additional token checks on payment-related endpoints.
- [Prometheus Metrics](/docs/reference/modules/prometheus) for monitoring notification volume and error rates.
- [Request ID](/docs/reference/modules/requestid) for correlating WeChat Pay callback requests through logs.
