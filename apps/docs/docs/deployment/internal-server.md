# Production on a company server

This page takes Seredina from a test install to production, on a server
inside your company's network. It follows the other deployment pages and
adds what an internal network changes:

- DNS.
- Certificates.
- The firewall.
- What can and can't work without being reachable from the internet.

## 1. The server

- **Operating system.** Any Linux with Docker Engine and the
  `docker compose` plugin. The examples below use Ubuntu Server 24.04 LTS.
- **Size.** For a small or medium team, start with 2 vCPUs, 4 GB of RAM
  and 40 GB of disk. Add more for a large ticket history or many
  attachments. With the local AI option (Ollama), add the memory your
  model needs.
- **Address.** Give the server a fixed IP address, or a DHCP reservation.
- **Admin access.** Only the people who administer it should have SSH
  access. Keep the system up to date with automatic security updates
  (`unattended-upgrades` on Ubuntu).

## 2. A name for it

Choose the address people will type, and create it in your internal DNS
(Active Directory DNS, your router, etc.) pointing at the server.

**Use a name under your company's real domain**, even if it's only
resolvable inside the network, for example `helpdesk.yourcompany.com`,
rather than `helpdesk.local` or a bare IP address. Google only accepts
OAuth redirect addresses under a public top-level domain. So a `.local`
name, or an IP, rules out Gmail mailboxes and Google sign-in. The name
doesn't have to be reachable from the internet: only your users'
browsers visit it.

## 3. Install

```bash
sudo mkdir -p /opt/seredina && sudo chown "$USER" /opt/seredina
git clone https://github.com/Haphior/helpdesk-seredina.git /opt/seredina
cd /opt/seredina
./scripts/setup.sh
```

`setup.sh` writes `.env` with random secrets. **Copy `.env` somewhere safe,
off this server, right now** (a password manager or a vault). Without its
`ENCRYPTION_KEY`, a backup can't be restored with the mailboxes, SSO and
users' two-factor sign-in intact. See
[what else you need to back up](/deployment/updates-and-backups#what-else-you-need-to-back-up).

## 4. Certificate and address

Pick one:

- **Your company has its own CA** (for example Active Directory Certificate
  Services). Issue a certificate for the name, and use it:

  ```bash
  ./scripts/configure-address.sh --address helpdesk.yourcompany.com --tls custom \
    --cert fullchain.pem --key key.pem --ca company-root-ca.pem
  ```

  Browsers on domain-joined computers already trust that CA.

- **No company CA.** Seredina generates its own:

  ```bash
  ./scripts/configure-address.sh --address helpdesk.yourcompany.com --tls internal
  ```

  Then install the generated root certificate on your team's computers,
  by hand or through group policy. See
  [Browsers with `internal`](/deployment/#your-address-and-https).

Let's Encrypt (`acme`) isn't an option for a server the internet can't
reach, because it needs to reach ports 80 and 443 from outside.

Then start everything:

```bash
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml ps
```

`configure-address.sh` sets `WEB_ORIGIN` and `API_PUBLIC_URL` to
`https://<name>` and `https://<name>/api`. Every emailed link, and every
OAuth or SSO redirect, is built from those.

Open `https://<name>`, register your organization, and turn on two-factor
sign-in for the admin accounts (**Account security**).

## 5. Firewall

On the server, with `ufw` for example:

```bash
sudo ufw default deny incoming
sudo ufw allow from 10.0.0.0/8 to any port 443 proto tcp   # your LAN ranges
sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp    # redirects to HTTPS
sudo ufw allow from <admin network> to any port 22 proto tcp
sudo ufw enable
```

Docker publishes ports through its own rules, not ufw's. Seredina keeps
Postgres, Redis, and (once the proxy is on) the web and API ports bound to
`127.0.0.1`, so only 80 and 443 face the network. Check it with
`sudo ss -ltnp`.

Outbound, the server needs:

| To | For |
|---|---|
| Your mail servers (IMAP 993, SMTP 587/465), or `imap.gmail.com`, `outlook.office365.com`, `login.microsoftonline.com`, `oauth2.googleapis.com` on 443 | Email channels |
| Your AI provider's API on 443 | The AI copilot, unless you run Ollama locally |
| Docker Hub, GitHub, npm on 443 | Building and updating |

## 6. What works on an internal-only server

| Feature | Internal-only server |
|---|---|
| Console, tickets, SLA, CMDB, network scans | Yes |
| Email channels (IMAP/SMTP, Microsoft 365, Gmail) | Yes: the server connects out to the mailboxes |
| Sign-in with Microsoft Entra ID | Yes: the redirect is an internal `https://` address |
| Sign-in with Google, Gmail mailboxes | Yes, with a name under a public domain (see step 2) |
| Customer portal, emailed links | For people on your network or VPN. The links point at the internal name. |
| Telegram | No: Telegram must call the server from the internet |
| Monitoring webhooks (Zabbix, etc.) | From systems on your network |

## 7. Agents on your computers

Install the [agent](/guide/cmdb-and-assets#devices) on your company's
computers. Use **Devices → Generate enrollment command**, pick the operating
system, and run the command as administrator. The command carries the
server's CA, so the agent trusts your certificate without anything being
installed on the computer.

- **For many computers:** each token is valid for 15 minutes, for one
  computer. Generate one per computer, or distribute the command from your
  management tool (Intune, GPO startup script, Jamf, Ansible) in small
  batches.
- **Computers without access to GitHub:** copy a
  [release](https://github.com/Haphior/seredina-agent/releases)'s files to
  an internal web server and set `AGENT_DOWNLOAD_URL`. See
  [Environment variables](/deployment/environment-variables).
- **Laptops outside the office:** they check in when they're back on the
  network or connected to the VPN. The agent retries every hour.

## 8. Backups

Schedule the nightly dump from
[Updates and Backups](/deployment/updates-and-backups#backups) with cron,
and copy the dumps **to another machine** (a NAS, a file server, object
storage). Also back up the `caddy_data` volume if you use `internal`:

```bash
docker run --rm -v infra_caddy_data:/data -v /var/backups/seredina:/out alpine \
  tar czf /out/caddy-data-$(date +%Y%m%d).tgz -C /data .
```

The name is `infra_caddy_data` unless you set a compose project name: check it with
`docker volume ls`. If you lose it, a new CA is generated, and every agent
and browser must be given the new one.

Before going live, **restore a backup on a test machine** and sign in to it.

## 9. Updates

Follow [Updating your instance](/deployment/updates-and-backups#updating-your-instance).
Take a backup just before, and update outside working hours.

## Go-live checklist

- [ ] The name resolves to the server from users' computers, and the site loads with no certificate warning.
- [ ] `.env` is copied somewhere safe, off the server.
- [ ] Admin accounts have two-factor sign-in; SSO works if you use it.
- [ ] An email to each support mailbox becomes a ticket, and the reply reaches the sender.
- [ ] A "forgot your password" email arrives, and its link opens.
- [ ] One Windows, one macOS and one Linux computer are enrolled and show up under **Assets**.
- [ ] The firewall only exposes 80/443 (and SSH to admins): check with `ss -ltnp` and a port scan from another machine.
- [ ] The nightly backup runs, is copied off the server, and a restore was tested.
- [ ] Someone gets the server's disk-space and backup-failure alerts.
