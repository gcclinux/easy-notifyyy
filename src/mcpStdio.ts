import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { handleMcpJsonRpc, JsonRpcRequest } from './mcpProtocol';
import { AiTaskEvent } from './types';

interface DiscoveredServerInfo {
  notifyUrl?: string;
  port?: number;
}

async function resolveNotifyUrl(): Promise<string> {
  const customInfoPath =
    process.env.EASY_NOTIFY_SERVER_FILE ||
    path.join(os.homedir(), '.easy-notifyyy', 'server.json');

  try {
    const raw = await fs.readFile(customInfoPath, 'utf8');
    const info = JSON.parse(raw) as DiscoveredServerInfo;
    if (info.notifyUrl) {
      return info.notifyUrl;
    }
    if (info.port) {
      return `http://127.0.0.1:${info.port}/notify`;
    }
  } catch {
    // Fall back to default port when server info file does not exist.
  }

  const fallbackPort = process.env.EASY_NOTIFY_PORT || '47831';
  return `http://127.0.0.1:${fallbackPort}/notify`;
}

async function forwardEventToExtension(
  event: AiTaskEvent
): Promise<{ sent: boolean; reason?: string }> {
  const notifyUrl = await resolveNotifyUrl();
  const workspaceName = event.workspaceName || path.basename(process.cwd());

  const response = await fetch(notifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...event,
      workspaceName,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }

  const data = (await response.json()) as {
    result?: { sent?: boolean; reason?: string };
  };
  return {
    sent: Boolean(data.result?.sent),
    reason: data.result?.reason,
  };
}

function main(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })}\n`
      );
      return;
    }

    const res = await handleMcpJsonRpc(req, forwardEventToExtension);
    if (res) {
      process.stdout.write(`${JSON.stringify(res)}\n`);
    }
  });
}

main();
