#!/bin/bash
set -euo pipefail

# Chooses the address this Seredina instance is reached at and how it gets a
# TLS certificate (docs/adr/0054-server-address-and-tls.md). Safe to re-run
# any time to change either; it only rewrites the address/TLS keys in .env.
#
# Interactive:        scripts/configure-address.sh
# Non-interactive:    scripts/configure-address.sh --address helpdesk.example.com --tls acme --email ops@example.com
#                     scripts/configure-address.sh --address 192.168.1.20 --tls internal
#                     scripts/configure-address.sh --address helpdesk.corp --tls custom --cert fullchain.pem --key key.pem [--ca corp-root.pem]
#                     scripts/configure-address.sh --address 192.168.1.20 --tls off
#
# TLS modes:
#   acme      Let's Encrypt, issued and renewed automatically. Needs a real
#             domain name pointing here, with ports 80/443 open to the internet.
#   custom    Your own certificate and key (e.g. from your company's CA).
#   internal  A private CA generated on first start. Works with an IP address
#             or an internal-only name; agents pin it from the Devices page.
#   off       Plain HTTP. Only for a lab, or when TLS ends somewhere in front.
#
# From then on the proxy is the only way in from the network: the web and API
# ports (8080/4000) only listen on this machine. --keep-direct-ports leaves
# them open too, e.g. while agents enrolled at http://<ip>:4000 are moved over.

cd "$(dirname "$0")/.."

ADDRESS=""
KEEP_DIRECT_PORTS=0
TLS_MODE_ARG=""
EMAIL=""
CERT=""
KEY=""
CA=""

usage() {
  sed -n '4,25p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --address) ADDRESS="${2:-}"; shift 2 ;;
    --tls) TLS_MODE_ARG="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --cert) CERT="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --ca) CA="${2:-}"; shift 2 ;;
    --keep-direct-ports) KEEP_DIRECT_PORTS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[address] unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

fail() {
  echo "[address] $*" >&2
  exit 1
}

if [ ! -f .env ]; then
  fail ".env not found -- run scripts/setup.sh first."
fi

ask() {
  # ask <prompt> <default> -> echoes the answer
  local answer
  read -r -p "$1${2:+ [$2]}: " answer
  echo "${answer:-$2}"
}

env_get() {
  grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true
}

# Sets KEY=value in .env, replacing an existing line or appending one. Values
# written here are validated below and never contain a newline or '|'.
env_set() {
  if grep -qE "^$1=" .env; then
    local value=${2//\\/\\\\}
    value=${value//&/\\&}
    sed -i.bak "s|^$1=.*|$1=$value|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

is_ip() {
  [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || [[ "$1" == *:*:* ]]
}

# --- address -----------------------------------------------------------------
if [ -z "$ADDRESS" ]; then
  echo "Which address will people and agents use to reach this server?"
  echo "  A domain name (helpdesk.example.com) or this server's IP (192.168.1.20)."
  ADDRESS=$(ask "Address" "$(env_get SEREDINA_SITE | sed 's|^http://||')")
fi
ADDRESS="${ADDRESS#http://}"
ADDRESS="${ADDRESS#https://}"
ADDRESS="${ADDRESS%%/*}"
# ']' first and '[' second inside the brackets is how a POSIX class matches
# them literally (for a bracketed IPv6 address); backslashes don't work there.
ADDRESS_RE='^[][A-Za-z0-9.:-]+$'
if [ -z "$ADDRESS" ] || ! [[ "$ADDRESS" =~ $ADDRESS_RE ]]; then
  fail "\"$ADDRESS\" doesn't look like a domain name or an IP address."
fi

# --- TLS mode ------------------------------------------------------------------
if [ -z "$TLS_MODE_ARG" ]; then
  echo
  echo "How should HTTPS get its certificate?"
  echo "  1) acme      Let's Encrypt, automatic (needs a public domain name)"
  echo "  2) custom    Your own certificate and key files"
  echo "  3) internal  A private CA generated here (IP address or internal name)"
  echo "  4) off       No HTTPS (lab only)"
  if is_ip "$ADDRESS"; then default_choice=3; else default_choice=1; fi
  case "$(ask "Choice" "$default_choice")" in
    1|acme) TLS_MODE_ARG=acme ;;
    2|custom) TLS_MODE_ARG=custom ;;
    3|internal) TLS_MODE_ARG=internal ;;
    4|off) TLS_MODE_ARG=off ;;
    *) fail "pick 1, 2, 3 or 4." ;;
  esac
fi

HTTP_PORT=$(env_get HTTP_PORT); HTTP_PORT=${HTTP_PORT:-80}
HTTPS_PORT=$(env_get HTTPS_PORT); HTTPS_PORT=${HTTPS_PORT:-443}
CA_FILE_IN_CONTAINER=""

case "$TLS_MODE_ARG" in
  acme)
    if is_ip "$ADDRESS"; then
      fail "Let's Encrypt needs a domain name, not an IP address -- use --tls internal or --tls custom for $ADDRESS."
    fi
    if [ -z "$EMAIL" ]; then
      EMAIL=$(ask "Email for certificate expiry warnings" "$(env_get ACME_EMAIL)")
    fi
    [[ "$EMAIL" =~ ^[^@[:space:]|]+@[^@[:space:]|]+$ ]] || fail "\"$EMAIL\" isn't a valid email address."
    ;;

  custom)
    command -v openssl >/dev/null 2>&1 || fail "openssl is needed to check the certificate."
    if [ -z "$CERT" ]; then CERT=$(ask "Certificate file (PEM, full chain)" ""); fi
    if [ -z "$KEY" ]; then KEY=$(ask "Private key file (PEM)" ""); fi
    [ -f "$CERT" ] || fail "certificate file not found: $CERT"
    [ -f "$KEY" ] || fail "key file not found: $KEY"
    openssl x509 -in "$CERT" -noout >/dev/null 2>&1 || fail "$CERT isn't a PEM certificate."
    # The key must belong to the certificate, or the proxy fails to start.
    if [ "$(openssl x509 -in "$CERT" -noout -pubkey | openssl sha256)" != "$(openssl pkey -in "$KEY" -pubout 2>/dev/null | openssl sha256)" ]; then
      fail "$KEY is not the private key for $CERT."
    fi
    # -checkip only for an IP: given a name, openssl reports "does match" for it.
    if is_ip "$ADDRESS"; then name_check=(-checkip "$ADDRESS"); else name_check=(-checkhost "$ADDRESS"); fi
    if ! openssl x509 -in "$CERT" -noout "${name_check[@]}" 2>/dev/null | grep -q ' does match'; then
      echo "[address] Warning: $CERT is not valid for \"$ADDRESS\" -- browsers and agents will reject it." >&2
    fi
    if [ -z "$CA" ] && [ -t 0 ]; then
      CA=$(ask "CA certificate that signed it, for agents to trust (empty if public or self-signed)" "")
    fi

    mkdir -p certs
    chmod 700 certs
    cp "$CERT" certs/cert.pem
    install -m 600 "$KEY" certs/key.pem
    rm -f certs/ca.pem
    if [ -n "$CA" ]; then
      [ -f "$CA" ] || fail "CA file not found: $CA"
      openssl verify -CAfile "$CA" "$CERT" >/dev/null 2>&1 || fail "$CERT is not signed by $CA."
      cp "$CA" certs/ca.pem
    elif [ "$(openssl x509 -in "$CERT" -noout -subject)" = "subject=$(openssl x509 -in "$CERT" -noout -issuer | sed 's/^issuer=//')" ]; then
      # Self-signed: the certificate is its own trust anchor.
      openssl x509 -in "$CERT" -out certs/ca.pem
    fi
    # Agents pin this; a certificate from a public CA needs nothing extra.
    [ -f certs/ca.pem ] && CA_FILE_IN_CONTAINER=/certs/ca.pem
    ;;

  internal)
    CA_FILE_IN_CONTAINER=/caddy-data/caddy/pki/authorities/local/root.crt
    ;;

  off)
    ;;

  *)
    fail "unknown TLS mode \"$TLS_MODE_ARG\" -- use acme, custom, internal or off."
    ;;
esac

# --- write .env ----------------------------------------------------------------
if [ "$TLS_MODE_ARG" = "off" ]; then
  SITE="http://$ADDRESS"
  ORIGIN="http://$ADDRESS"
  [ "$HTTP_PORT" != "80" ] && ORIGIN="$ORIGIN:$HTTP_PORT"
else
  SITE="$ADDRESS"
  ORIGIN="https://$ADDRESS"
  [ "$HTTPS_PORT" != "443" ] && ORIGIN="$ORIGIN:$HTTPS_PORT"
fi

# Keep any other profile (e.g. mcp) the operator already enabled.
PROFILES=$(env_get COMPOSE_PROFILES | tr ',' '\n' | grep -vx 'proxy' | grep -v '^$' | tr '\n' ',' || true)
PROFILES="${PROFILES}proxy"

env_set COMPOSE_PROFILES "$PROFILES"
env_set SEREDINA_SITE "$SITE"
env_set TLS_MODE "$TLS_MODE_ARG"
env_set ACME_EMAIL "$EMAIL"
env_set TLS_CA_FILE "$CA_FILE_IN_CONTAINER"
env_set WEB_ORIGIN "$ORIGIN"
env_set API_PUBLIC_URL "$ORIGIN/api"
# The console finds the API at /api on its own address from now on.
env_set VITE_API_URL ""
if [ "$KEEP_DIRECT_PORTS" = "1" ]; then
  env_set WEB_BIND 0.0.0.0
  env_set API_BIND 0.0.0.0
else
  # Otherwise anyone on the network could skip HTTPS -- and set their own
  # X-Forwarded-For, dodging per-IP rate limits -- via the direct ports.
  env_set WEB_BIND 127.0.0.1
  env_set API_BIND 127.0.0.1
fi

echo
echo "[address] Seredina will be at: $ORIGIN"
echo "[address] Agents connect to:   $ORIGIN/api"
case "$TLS_MODE_ARG" in
  acme) echo "[address] Certificate: Let's Encrypt, automatic. Point $ADDRESS at this server and open ports $HTTP_PORT and $HTTPS_PORT." ;;
  custom) echo "[address] Certificate: certs/cert.pem${CA_FILE_IN_CONTAINER:+ (agents pin certs/ca.pem)}." ;;
  internal) echo "[address] Certificate: private CA, created on first start. Browsers warn until you trust it -- see the deployment docs." ;;
  off) echo "[address] No HTTPS: passwords and agent credentials travel unencrypted." ;;
esac
echo "[address]"
echo "[address] Apply with: docker compose -f infra/docker-compose.yml up -d --build"
