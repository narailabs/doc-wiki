# Benchmark session/grade container. Build: docker build -t docwiki-bench-<repo> --build-arg TOOLCHAIN=node:22 benchmark/harness/docker/
ARG TOOLCHAIN=node:22
FROM ${TOOLCHAIN}
ARG CLAUDE_CODE_VERSION=latest
ENV DISABLE_AUTOUPDATER=1 \
    CLAUDE_CONFIG_DIR=/claude-cfg
RUN apt-get update && apt-get install -y --no-install-recommends git iptables dnsutils ca-certificates bash \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
    && mkdir -p /claude-cfg /out /work
COPY entrypoint.sh grade.sh init-firewall.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/grade.sh /usr/local/bin/init-firewall.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
