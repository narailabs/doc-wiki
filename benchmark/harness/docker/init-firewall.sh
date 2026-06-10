#!/usr/bin/env bash
# Lock egress to Anthropic endpoints only. Requires --cap-add=NET_ADMIN.
set -euo pipefail

ALLOWED_DOMAINS=(api.anthropic.com claude.ai statsig.anthropic.com sentry.io)

iptables -F OUTPUT
# Loopback + established flows + DNS stay open.
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

for domain in "${ALLOWED_DOMAINS[@]}"; do
  for ip in $(dig +short A "$domain" | grep -E '^[0-9.]+$'); do
    iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
  done
done

iptables -A OUTPUT -j REJECT
echo "egress locked to: ${ALLOWED_DOMAINS[*]}" >&2
