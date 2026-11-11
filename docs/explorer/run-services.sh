#!/usr/bin/env bash
# Runs the three services this explorer runs for real (currency, payment, ads) from Google's v0.10.7 images,
# with plain Docker, the memory limits from kubernetes-manifests/, and every port on 127.0.0.1 only.
#
#   docs/explorer/run-services.sh up      # start them, no debugger
#   docs/explorer/run-services.sh debug   # start them with a debugger port each (see below)
#   docs/explorer/run-services.sh drive [scenario…]   # send real gRPC requests (docs/explorer/drive.js)
#   docs/explorer/run-services.sh restart currency|payment|ads   # one service, cold, no debugger (labs)
#                                 CPUS=0.2 … restart currency      # … with a CPU limit (manifest: limits.cpu 200m)
#   docs/explorer/run-services.sh down    # stop and remove only what this script started
#
# Debug ports (127.0.0.1): currency Node inspector 9229 · payment Node inspector 9230 · ads JDWP 5005.
# The debugger is switched on by overriding the container's command/env at run time; the images are unchanged.
# Host port 7001 is used for currency because macOS keeps 7000 for AirPlay Receiver.
set -euo pipefail
REG=us-central1-docker.pkg.dev/online-boutique-ci/microservices-demo
TAG=v0.10.7
NET=bx-boutique
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

up() {
  local debug=${1:-}
  docker network inspect $NET >/dev/null 2>&1 || docker network create $NET >/dev/null
  local cur_cmd=() pay_cmd=() ads_env=() cur_ports=() pay_ports=() ads_ports=()
  if [[ $debug == debug ]]; then
    cur_cmd=(--entrypoint node); cur_args=(--inspect=0.0.0.0:9229 server.js); cur_ports=(-p 127.0.0.1:9229:9229)
    pay_cmd=(--entrypoint node); pay_args=(--inspect=0.0.0.0:9229 index.js);  pay_ports=(-p 127.0.0.1:9230:9229)
    ads_env=(-e "JAVA_TOOL_OPTIONS=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"); ads_ports=(-p 127.0.0.1:5005:5005)
  else
    cur_args=(); pay_args=()
  fi
  # memory and memory-swap equal: the limits.memory of each Deployment in kubernetes-manifests/
  docker run -d --name bx-currency --network $NET --memory 128m --memory-swap 128m \
    -e PORT=7000 -e DISABLE_PROFILER=1 -p 127.0.0.1:7001:7000 ${cur_ports[@]+"${cur_ports[@]}"} ${cur_cmd[@]+"${cur_cmd[@]}"} \
    $REG/currencyservice:$TAG ${cur_args[@]+"${cur_args[@]}"} >/dev/null
  docker run -d --name bx-payment --network $NET --memory 128m --memory-swap 128m \
    -e PORT=50051 -e DISABLE_PROFILER=1 -p 127.0.0.1:50051:50051 ${pay_ports[@]+"${pay_ports[@]}"} ${pay_cmd[@]+"${pay_cmd[@]}"} \
    $REG/paymentservice:$TAG ${pay_args[@]+"${pay_args[@]}"} >/dev/null
  docker run -d --name bx-ads --network $NET --memory 300m --memory-swap 300m \
    -e PORT=9555 -e DISABLE_STATS=1 -e DISABLE_TRACING=1 -p 127.0.0.1:9555:9555 ${ads_ports[@]+"${ads_ports[@]}"} ${ads_env[@]+"${ads_env[@]}"} \
    $REG/adservice:$TAG >/dev/null
  docker ps --filter name=bx- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
}

drive() {
  # A throwaway container from the currency image (it already has @grpc/grpc-js and @grpc/proto-loader).
  docker run --rm --network $NET --memory 128m --memory-swap 128m \
    -v "$ROOT/protos:/protos:ro" -v "$ROOT/docs/explorer/drive.js:/drive/drive.js:ro" \
    -e CONC="${CONC:-4}" -e DUR="${DUR:-10}" -e NODE_PATH=/usr/src/app/node_modules --entrypoint node $REG/currencyservice:$TAG /drive/drive.js "$@"
}

restart() {
  # Labs measure without a debugger attached: a paused or instrumented process changes the numbers.
  local cpus=(); [[ -n "${CPUS:-}" ]] && cpus=(--cpus "$CPUS")
  case "$1" in
    currency) docker rm -f bx-currency >/dev/null 2>&1 || true
      docker run -d --name bx-currency --network $NET --memory 128m --memory-swap 128m ${cpus[@]+"${cpus[@]}"} \
        -e PORT=7000 -e DISABLE_PROFILER=1 -p 127.0.0.1:7001:7000 $REG/currencyservice:$TAG >/dev/null ;;
    payment) docker rm -f bx-payment >/dev/null 2>&1 || true
      docker run -d --name bx-payment --network $NET --memory 128m --memory-swap 128m ${cpus[@]+"${cpus[@]}"} \
        -e PORT=50051 -e DISABLE_PROFILER=1 -p 127.0.0.1:50051:50051 $REG/paymentservice:$TAG >/dev/null ;;
    ads) docker rm -f bx-ads >/dev/null 2>&1 || true
      docker run -d --name bx-ads --network $NET --memory 300m --memory-swap 300m ${cpus[@]+"${cpus[@]}"} \
        -e PORT=9555 -e DISABLE_STATS=1 -e DISABLE_TRACING=1 -p 127.0.0.1:9555:9555 $REG/adservice:$TAG >/dev/null ;;
    *) echo "restart currency|payment|ads"; exit 1 ;;
  esac
  # wait until it says it's listening
  local name=bx-$1 pat='started|listening'
  for _ in $(seq 1 120); do docker logs $name 2>&1 | grep -qE "$pat" && break; sleep 0.5; done
  docker ps --filter name=$name --format '{{.Names}}\t{{.Status}}'
}

down() {
  docker rm -f bx-currency bx-payment bx-ads >/dev/null 2>&1 || true
  docker network rm $NET >/dev/null 2>&1 || true
}

case "${1:-}" in
  up) up ;;
  debug) up debug ;;
  drive) shift; drive "$@" ;;
  restart) shift; restart "$@" ;;
  down) down ;;
  *) echo "usage: $0 up|debug|drive [scenario…]|restart currency|payment|ads|down"; exit 1 ;;
esac
