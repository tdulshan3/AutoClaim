#!/usr/bin/env bash
# Retry launching an Always Free instance until OCI has capacity, then deploy.
#
# Only ever attempts the two Always Free shapes. It must never fall back to a
# billable shape, and it must never end up creating two instances, so it checks
# for an existing one before every attempt and exits the moment one exists.
#
# One shape per round with a long gap: OCI throttles launch attempts, and
# hammering it returns "Too many requests" instead of capacity, which makes
# retrying actively counterproductive.
#
# Auth is an API key rather than a session token, because session tokens die
# after a few hours and a capacity wait can run for days.

set -uo pipefail
export SUPPRESS_LABEL_WARNING=True

SD=/tmp/claude-1000/-home-tdulshan-StudioProjects-nelu-mob/d32477a3-a834-471b-a57b-13542d4e50be/scratchpad
PROJ=/home/tdulshan/Projects/AutoClaim
OCI_CFG="$HOME/.oci/config_apikey"
source "$SD/oci-state.env"

oci_() { oci --config-file "$OCI_CFG" "$@"; }

ARM_IMAGE=ocid1.image.oc1.ap-singapore-1.aaaaaaaakkcufaxe5ebkgdaaaiyozntfh27q6arlz6hbwcj462sfgha2q3xa
X86_IMAGE=$IMAGE
LOG="$SD/retry.log"
DELAY=300           # 5 minutes between attempts
BACKOFF=900         # 15 minutes after a throttle
MAX_AUTH_FAILS=20   # ~100 min of solid auth failure before giving up

attempt=0
authfails=0
shape=a1

while true; do
  attempt=$((attempt + 1))

  # Guard: never create a second instance.
  existing=$(oci_ compute instance list --compartment-id "$T" 2>/dev/null \
    | node -pe 'try{JSON.parse(require("fs").readFileSync(0,"utf8")).data.filter(i=>i["lifecycle-state"]!=="TERMINATED").length}catch(e){""}')
  if [ -n "$existing" ] && [ "$existing" -gt 0 ] 2>/dev/null; then
    echo "$(date -Is) instance already exists, stopping" >> "$LOG"
    exit 0
  fi

  if [ "$shape" = "a1" ]; then
    out=$(oci_ compute instance launch --compartment-id "$T" --availability-domain "$AD" \
      --shape "VM.Standard.A1.Flex" --shape-config '{"ocpus":1,"memoryInGBs":6}' \
      --image-id "$ARM_IMAGE" --subnet-id "$SUBNET" --display-name autoclaim \
      --assign-public-ip true --boot-volume-size-in-gbs 50 \
      --ssh-authorized-keys-file "$HOME/.ssh/oci_autoclaim.pub" \
      --wait-for-state RUNNING 2>&1)
    next=micro
  else
    out=$(oci_ compute instance launch --compartment-id "$T" --availability-domain "$AD" \
      --shape "VM.Standard.E2.1.Micro" \
      --image-id "$X86_IMAGE" --subnet-id "$SUBNET" --display-name autoclaim \
      --assign-public-ip true --boot-volume-size-in-gbs 50 \
      --ssh-authorized-keys-file "$HOME/.ssh/oci_autoclaim.pub" \
      --wait-for-state RUNNING 2>&1)
    next=a1
  fi

  if echo "$out" | grep -q '"lifecycle-state": "RUNNING"'; then
    echo "$out" > "$SD/instance.json"
    echo "$(date -Is) SUCCESS on $shape after $attempt attempts" >> "$LOG"

    # Capacity may free up long after anyone is watching, so finish the job
    # rather than leaving a bare VM sitting there.
    INSTANCE_ID=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data.id' "$SD/instance.json")
    VNIC=$(oci_ compute instance list-vnics --instance-id "$INSTANCE_ID" 2>/dev/null \
      | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data[0]["public-ip"]')
    echo "$(date -Is) public ip: $VNIC" >> "$LOG"
    { echo "export INSTANCE_ID=$INSTANCE_ID"; echo "export PUBLIC_IP=$VNIC"; } >> "$SD/oci-state.env"

    echo "$(date -Is) waiting for sshd" >> "$LOG"
    for i in $(seq 1 40); do
      if ssh -i "$HOME/.ssh/oci_autoclaim" -o StrictHostKeyChecking=accept-new \
           -o ConnectTimeout=10 -o BatchMode=yes "ubuntu@$VNIC" true 2>/dev/null; then
        echo "$(date -Is) ssh up after $i tries" >> "$LOG"
        break
      fi
      sleep 15
    done

    echo "$(date -Is) bootstrapping" >> "$LOG"
    ssh -i "$HOME/.ssh/oci_autoclaim" -o StrictHostKeyChecking=accept-new \
      "ubuntu@$VNIC" 'bash -s' < "$PROJ/deploy/bootstrap.sh" >> "$SD/deploy.log" 2>&1
    echo "$(date -Is) bootstrap exit=$?" >> "$LOG"

    echo "$(date -Is) deploying" >> "$LOG"
    bash "$PROJ/deploy/push.sh" "$VNIC" >> "$SD/deploy.log" 2>&1
    echo "$(date -Is) deploy exit=$? - see deploy.log" >> "$LOG"
    exit 0
  fi

  reason=$(echo "$out" | grep -o '"message": "[^"]*"' | head -1 | sed 's/"message": //')
  echo "$(date -Is) #$attempt $shape -> ${reason:-unknown}" >> "$LOG"

  # A freshly uploaded API key replicates across OCI's identity fleet over
  # several minutes, so an isolated NotAuthenticated is transient. Only give up
  # if it never recovers, which would mean the key is genuinely broken.
  if echo "$out" | grep -qi 'NotAuthenticated'; then
    authfails=$((authfails + 1))
    if [ "$authfails" -ge "$MAX_AUTH_FAILS" ]; then
      echo "$(date -Is) ABORT: $authfails consecutive auth failures, check the API key" >> "$LOG"
      exit 2
    fi
  else
    authfails=0
  fi

  if echo "$out" | grep -qi 'Too many requests'; then
    echo "$(date -Is) throttled, backing off ${BACKOFF}s" >> "$LOG"
    sleep "$BACKOFF"
  else
    sleep "$DELAY"
  fi

  shape=$next
done
