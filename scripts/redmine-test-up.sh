#!/usr/bin/env bash
set -euo pipefail

compose_file="${REDMINE_TEST_COMPOSE_FILE:-docker-compose.redmine-test.yml}"
port="${REDMINE_TEST_PORT:-3000}"
base_url="http://127.0.0.1:${port}"
env_output="${REDMINE_TEST_ENV_OUTPUT:-.env.test.docker}"

docker compose -f "${compose_file}" up -d

printf 'Waiting for Redmine Rails environment'
ready=0
for _ in $(seq 1 90); do
  if docker compose -f "${compose_file}" exec -T redmine bundle exec rails runner 'puts "ready"' >/tmp/redmine-mcp-test-ready.log 2>&1; then
    printf '\n'
    ready=1
    break
  fi
  printf '.'
  sleep 5
done

if [ "${ready}" -ne 1 ]; then
  printf '\nRedmine did not become ready. Last readiness output:\n' >&2
  cat /tmp/redmine-mcp-test-ready.log >&2 || true
  exit 1
fi

docker compose -f "${compose_file}" exec -T redmine bundle exec rake redmine:load_default_data REDMINE_LANG=en >/tmp/redmine-mcp-test-default-data.log 2>&1 || {
  printf 'Failed to load Redmine default data:\n' >&2
  cat /tmp/redmine-mcp-test-default-data.log >&2 || true
  exit 1
}

api_key="$(
  docker compose -f "${compose_file}" exec -T redmine bundle exec rails runner '
    Setting.rest_api_enabled = "1"
    Setting.default_language = "en"
    Setting.login_required = "0"

    admin = User.find_by(login: "admin") || User.new(login: "admin")
    admin.admin = true
    admin.firstname = "Redmine"
    admin.lastname = "Admin"
    admin.mail = "admin@example.test"
    admin.status = User::STATUS_ACTIVE
    admin.password = "adminadmin"
    admin.password_confirmation = "adminadmin"
    admin.must_change_passwd = false if admin.respond_to?(:must_change_passwd=)
    admin.save!

    token = Token.find_by(user_id: admin.id, action: "api") || Token.create!(user_id: admin.id, action: "api")
    puts token.value
  ' | tail -n 1
)"

cat > "${env_output}" <<EOF
REDMINE_E2E=1
REDMINE_E2E_URL=${base_url}
REDMINE_E2E_API_KEY=${api_key}
EOF

if [ ! -e .env.test ]; then
  cp "${env_output}" .env.test
  env_message=".env.test was created"
else
  env_message=".env.test already exists and was not overwritten; ${env_output} was updated"
fi

cat <<EOF
Redmine test instance is ready:
  URL:      ${base_url}
  login:    admin
  password: adminadmin
  API key:  ${api_key}

${env_message}

Run e2e tests with:
  npm run test:e2e

Stop the instance with:
  npm run redmine:test:down

Reset all Redmine test data with:
  npm run redmine:test:reset
EOF
