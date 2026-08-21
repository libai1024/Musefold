#!/usr/bin/env bash
# One-time production bootstrap for V121-ENV-07 / V121-WEB-01 / V121-WEB-02.
# Run on musefold-cloud as root. Does not register the GitHub Actions runner
# until the operator downloads the runner tarball and (optionally) exports
# RUNNER_TOKEN. The token is minted in the GitHub UI and must never be committed.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-musefold-deploy}"
DEPLOY_HOME="/home/${DEPLOY_USER}"
RUNNER_DIR="/opt/musefold/actions-runner"
SITE_ROOT="/opt/musefold/site/Musefold"
COMPOSE_DIR="/opt/musefold"
LABELS="${RUNNER_LABELS:-musefold-prod}"
REPO_URL="${REPO_URL:-https://github.com/libai1024/Musefold}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${DEPLOY_HOME}" --shell /bin/bash "${DEPLOY_USER}"
fi

if getent group docker >/dev/null; then
  usermod -aG docker "${DEPLOY_USER}"
else
  echo "docker group missing; install Docker before this script" >&2
  exit 1
fi

mkdir -p "${SITE_ROOT}/releases" "${COMPOSE_DIR}/archive" "${RUNNER_DIR}"
touch "${COMPOSE_DIR}/.deploy-state.json"
[[ -f "${COMPOSE_DIR}/Caddyfile" ]] || touch "${COMPOSE_DIR}/Caddyfile"
[[ -f "${COMPOSE_DIR}/docker-compose.yml" ]] || touch "${COMPOSE_DIR}/docker-compose.yml"

chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${SITE_ROOT}" "${COMPOSE_DIR}/archive" "${RUNNER_DIR}"
chown "${DEPLOY_USER}:${DEPLOY_USER}" \
  "${COMPOSE_DIR}/Caddyfile" \
  "${COMPOSE_DIR}/docker-compose.yml" \
  "${COMPOSE_DIR}/.deploy-state.json"
chmod 644 "${COMPOSE_DIR}/Caddyfile" "${COMPOSE_DIR}/docker-compose.yml"
chmod 600 "${COMPOSE_DIR}/.deploy-state.json"

if [[ -f "${COMPOSE_DIR}/.env.v11" ]]; then
  chown root:docker "${COMPOSE_DIR}/.env.v11"
  chmod 640 "${COMPOSE_DIR}/.env.v11"
fi

mkdir -p /opt/musefold/actions-runner/systemd-drop-in
cat > /opt/musefold/actions-runner/systemd-drop-in/limits.conf <<'EOF'
[Service]
CPUQuota=400%
MemoryMax=4G
Nice=5
EOF
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" /opt/musefold/actions-runner/systemd-drop-in

echo "deploy user: ${DEPLOY_USER} (docker group; writes site + Caddyfile + compose)"
echo
echo "Register the GitHub runner:"
echo "  1. GitHub → repo Settings → Actions → Runners → New self-hosted runner"
echo "  2. su - ${DEPLOY_USER}"
echo "  3. cd ${RUNNER_DIR} && curl -o actions-runner.tgz -L <linux-x64-url-from-ui> && tar xzf actions-runner.tgz"
echo "  4. ./config.sh --url ${REPO_URL} --token \$RUNNER_TOKEN --labels ${LABELS} --unattended --replace"
echo "  5. as root: ${RUNNER_DIR}/svc.sh install ${DEPLOY_USER} && ${RUNNER_DIR}/svc.sh start"
echo "  6. copy systemd-drop-in/limits.conf into the generated actions.runner.*.service.d/ then systemctl daemon-reload"
echo
if [[ -n "${RUNNER_TOKEN:-}" ]]; then
  if [[ ! -x "${RUNNER_DIR}/config.sh" ]]; then
    echo "RUNNER_TOKEN is set but ${RUNNER_DIR}/config.sh is missing; download the runner tarball first." >&2
    exit 1
  fi
  sudo -u "${DEPLOY_USER}" "${RUNNER_DIR}/config.sh" --url "${REPO_URL}" --token "${RUNNER_TOKEN}" --labels "${LABELS}" --unattended --replace
  echo "runner configured; install the systemd service with svc.sh as root"
fi
