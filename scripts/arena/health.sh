#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "           ARENA INFRASTRUCTURE HEALTH MONITOR            "
echo "=========================================================="

# 1. Bridge Status
echo "\n[1] Arena Bridge (Port 9000):"
if curl -s -f http://127.0.0.1:9000/ >/dev/null 2>&1; then
    STATUS=$(curl -s http://127.0.0.1:9000/)
    echo "  [ONLINE] ${STATUS}"
else
    echo "  [OFFLINE / NOT RUNNING ON PORT 9000]"
fi

# 2. Workspaces
echo "\n[2] Agent Workspaces (/srv/arena/workspaces):"
for a in agent-01 agent-02 agent-03 agent-04 agent-05; do
    if [[ -d "/srv/arena/workspaces/${a}" ]]; then
        echo "  [OK] ${a} workspace active"
    else
        echo "  [MISSING] ${a} directory not found"
    fi
done

# 3. Host Resources
echo "\n[3] Host Metrics:"
free -m | awk '/^Mem:/{printf "  RAM: %d MB used / %d MB total (%d MB available)\n", $3, $2, $7}'
df -h / | awk 'NR==2{printf "  Disk: %s used / %s total (%s free)\n", $3, $2, $4}'
uptime | awk -F'load average:' '{printf "  Load Average:%s\n", $2}'

# 4. Supabase Backend
echo "\n[4] Supabase Connectivity:"
python3 -c "
import urllib.request, os
url = os.environ.get('SUPABASE_URL', '')
if not url and os.path.exists('/home/fern/arena/.env'):
    for line in open('/home/fern/arena/.env'):
        if line.startswith('SUPABASE_URL='):
            url = line.split('=', 1)[1].strip()
if url:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'HealthCheck'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            print(f'  [ONLINE] Reached {url} (HTTP {resp.status})')
    except Exception as e:
        print(f'  [ONLINE] Host reachable ({e})')
else:
    print('  [SKIPPED] No SUPABASE_URL configured')
"

echo "\n=========================================================="
