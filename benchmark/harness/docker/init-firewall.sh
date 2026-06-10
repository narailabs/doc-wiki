#!/usr/bin/env bash
# Lock egress to Anthropic endpoints only. Requires --cap-add=NET_ADMIN.
set -euo pipefail

ALLOWED_DOMAINS=(api.anthropic.com claude.ai statsig.anthropic.com)

# Fail-closed: default-drop FIRST, so a mid-script failure leaves the chain closed.
iptables -P OUTPUT DROP
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

# IPv6: fail-closed if ip6tables exists; if the kernel lacks v6 there's no v6 egress to close.
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -P OUTPUT DROP 2>/dev/null || true
  ip6tables -F OUTPUT 2>/dev/null || true
  ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
  ip6tables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
fi

echo "egress locked to: ${ALLOWED_DOMAINS[*]}" >&2
