# Benchmark session/grade container. Build: docker build -t docwiki-bench-<repo> --build-arg TOOLCHAIN=node:22 benchmark/harness/docker/
ARG TOOLCHAIN=node:22
FROM ${TOOLCHAIN}
ARG CLAUDE_CODE_VERSION=2.1.170
ENV DISABLE_AUTOUPDATER=1 \
    CLAUDE_CONFIG_DIR=/claude-cfg
RUN apt-get update && apt-get install -y --no-install-recommends git iptables dnsutils ca-certificates bash sudo \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
    && mkdir -p /claude-cfg /out /work \
    # Claude Code refuses --dangerously-skip-permissions as root; run as the image's
    # non-root user (Anthropic devcontainer pattern). The firewall still needs root —
    # grant a single NOPASSWD sudo rule scoped to that one script.
    && chown -R node:node /claude-cfg /out /work \
    && echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/bench-firewall \
    && chmod 440 /etc/sudoers.d/bench-firewall
COPY entrypoint.sh grade.sh init-firewall.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/grade.sh /usr/local/bin/init-firewall.sh
USER node
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
