# HTTPS and WSS setup (Windows LAN)

The queue server supports HTTPS and secure WebSockets (WSS) when a certificate and its matching private key are installed.

## Certificate requirements

Use a certificate issued by a trusted internal or public certificate authority. It must include the exact LAN DNS name or IP address that staff devices and the TV use in its Subject Alternative Name (SAN). Install the issuing CA certificate on every client device (Windows PCs, tablets, and the TV/browser) so browsers trust the connection.

A self-signed certificate that is not trusted by each client will show browser warnings and may prevent the app from working reliably. Do not bypass those warnings for normal operation.

## Install the files

1. Create the folder `server\certs\` on the queue server PC.
2. Copy the server certificate to `server\certs\server.crt`.
3. Copy its matching private key to `server\certs\server.key`.
4. Keep the private key secret. The folder is excluded from Git and must not be uploaded or shared.

The existing `START-INFINITY-SERVICES.bat` detects both files and enables HTTPS/WSS automatically. If either file is missing, it keeps the existing HTTP/WS mode.

You can also configure different paths by setting both `TLS_CERT_FILE` and `TLS_KEY_FILE` environment variables before starting the server. Both values are required together. If only one is configured or a file cannot be read, startup fails safely rather than silently falling back to HTTP.

## Access

With TLS configured, open:

- `https://<server-name-or-ip>:4000`
- WebSockets automatically use `wss://` from the same browser origin.

Use the same hostname/IP that appears in the certificate SAN. The app derives its WebSocket protocol from the page protocol.

## Network safety

Keep the Windows Firewall rule limited to the Private network and local subnet. Do not expose port 4000 directly to the public internet. TLS protects traffic in transit; it does not replace staff login or network controls.

Without certificate files, the system continues to support the existing HTTP/WS LAN workflow, but credentials and session tokens are not encrypted in transit.
