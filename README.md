# VARTA.iq Azure Viewer

A standalone Docker uploader for a VARTA.iq Energy Manager, with a private Azure website and its own user management. The original local viewer remains in the separate [varta.iq-viewer](https://github.com/kko/varta.iq-viewer) repository.

The collector reads `/v2/point` and `/v2/devices` every ten seconds over verified HTTPS. It saves packets durably before sending them, buffers up to 30 days during outages, and uploads the backlog when connectivity returns. Its local management interface shows settings, separate connection statuses, and the last ten errors.

Azure Table Storage holds measurements and aggregates. Static Web Apps Free hosts the website and its Node.js 22 API. An independent Azure Automation runbook runs daily to remove data outside the last 365 UTC calendar days and clean up expired sessions.

## Run the Docker collector

Install Docker Engine with Linux container support and Compose v2. Supported architectures are x64, ARM64, and ARMv7. The container has been built and run on an ARMv7 Raspberry Pi.

```sh
git clone https://github.com/kko/varta.iq-azure-viewer.git
cd varta.iq-azure-viewer
docker compose -f compose.collector.yaml up -d --build
```

Open the management interface at [http://localhost:8788](http://localhost:8788). To access it from your home network, copy `.env.example` to `.env` and add the Docker host's IP address or hostname, including `:8788`, to `COLLECTOR_ALLOWED_HOSTS`. On the Pi, use `sudo docker compose …` if required.

The local interface uses HTTP without a password. Enter the gateway IP, VARTA API key, Azure upload URL, collector ID, and upload key, then test the connections and enable uploads. Keep access to this interface within a trusted home network. Configuration and buffered packets are stored in separate persistent Docker volumes; `down -v` deletes them.

A dropdown at the top switches the collector interface between German and English. It translates settings, status messages, and known errors, and saves the language preference in the current browser. Switching languages preserves unsaved input.

## Set up Azure

Requirements: PowerShell 7.2+, Azure CLI, Node.js 22.9+ with npm/npx, and deployment and role-assignment permissions in the selected subscription.

```powershell
az login
./scripts/setup-azure.ps1 -SubscriptionId '<subscription-id>'
```

The repeatable setup script deploys the infrastructure, website, and API, configures daily cleanup, and outputs the upload configuration and a secret setup link. Existing upload keys and users are preserved. Storage and transaction charges may apply; a completely free deployment is not guaranteed.

## User management

1. Open your private setup link. In the one-time form, enter a username, email address, and your own password of at least 15 characters. This creates the first administrator.
2. Sign in with your username or email address. The setup link cannot create another administrator after initialization; public self-registration is disabled.
3. Under **Benutzerkonto** (User account), administrators can add viewers or administrators, change roles, disable accounts, and reset temporary passwords. Additional users must change their temporary password before accessing data.

The data APIs validate each session on the server. Password hashes use individual salts and PBKDF2-HMAC-SHA256 with 600,000 iterations. Session cookies are Secure, HttpOnly, and SameSite=Strict and expire after eight hours. Password changes, role changes, and account disabling invalidate existing sessions. Login attempts are persistently rate limited. The last active administrator cannot be disabled or demoted. Collector uploads use a separate upload key, independently of user sessions.

Microsoft organization consent is not required. Email addresses serve as login identifiers; email delivery, MFA, and automatic email-based password recovery are not currently configured. A managed identity provider is preferable for larger or particularly sensitive applications.

## Development and testing

```sh
npm ci
npm ci --prefix cloud/api
npm test
npm run test:storage
npx playwright install chromium
npm run test:ui
npm run acceptance -- --accelerated
```

The TLS tests require OpenSSL. Storage integration tests start a local Azurite emulator, and browser tests use Playwright. All tests use test data. Run `npm run prepare:cloud` to generate the deployable website in `cloud/site`; this directory is not tracked in Git.

The files in `public/` contain rendering components reused from the local viewer and the template for the cloud build. This repository starts the collector only; it does not include a second local viewer server.

For detailed setup instructions, APIs, cost assumptions, retention, and acceptance checks, see [COLLECTOR.md](COLLECTOR.md) (German). Run `npm run package:uploader` to create a compact Docker build archive. Never commit saved keys, configuration, measurements, or buffered packets.

License: [Apache 2.0](LICENSE).
