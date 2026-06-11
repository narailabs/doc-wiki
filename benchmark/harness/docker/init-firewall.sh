#!/usr/bin/env bash
# Lock egress to Anthropic endpoints only. Requires --cap-add=NET_ADMIN.
# Arg 1 (optional): "1" to also allow RFC1918 private nets (for local sidecars);
# anything else (or absent) keeps private nets blocked. Passed positionally so the
# scoped NOPASSWD sudoers rule needs no SETENV permission.
set -euo pipefail

ALLOW_PRIVATE="${1:-0}"

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

# Allow RFC1918 private ranges when sidecars are present so the agent can reach
# local DB/cache containers on the docker network, while public internet (incl.
# github → the fix) stays REJECTed — contamination guarantee preserved.
if [ "$ALLOW_PRIVATE" = "1" ]; then
  for cidr in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
    iptables -A OUTPUT -d "$cidr" -p tcp -j ACCEPT
  done
fi

iptables -A OUTPUT -j REJECT

# IPv6: fail-closed if ip6tables exists; if the kernel lacks v6 there's no v6 egress to close.
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -P OUTPUT DROP 2>/dev/null || true
  ip6tables -F OUTPUT 2>/dev/null || true
  ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
  ip6tables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
fi

echo "egress locked to: ${ALLOWED_DOMAINS[*]}" >&2
