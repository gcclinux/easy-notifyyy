import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export function buildHookNotifyCommand(
  defaultPort: number,
  source?: 'claude' | 'kiro'
): string {
  const query = source ? `?source=${source}` : '';
  const script = [
    "const fs=require('fs'),os=require('os'),p=require('path');",
    "let b='';",
    "process.stdin.on('data',c=>b+=c);",
    'process.stdin.on("end",async()=>{',
    `let port=${defaultPort};`,
    "try{port=JSON.parse(fs.readFileSync(p.join(os.homedir(),'.easy-notifyyy','server.json'),'utf8')).port||port}catch{}",
    `await fetch('http://127.0.0.1:'+port+'/notify${query}',{method:'POST',headers:{'Content-Type':'application/json'},body:b||'{}'}).catch(()=>{});`,
    '});',
  ].join('');

  return `node -e "${script}"`;
}

export function buildMcpConfigSnippets(
  mcpStdioPath: string,
  port: number
): string {
  const snippets = {
    stdioMcpServers: {
      mcpServers: {
        'easy-notifyyy': {
          command: 'node',
          args: [mcpStdioPath],
        },
      },
    },
    vscodeWorkspaceMcpJson: {
      servers: {
        'easy-notifyyy': {
          type: 'http',
          url: `http://127.0.0.1:${port}/mcp`,
        },
      },
    },
    claudeCodeHooks: {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: buildHookNotifyCommand(port, 'claude'),
              },
            ],
          },
        ],
        Notification: [
          {
            hooks: [
              {
                type: 'command',
                command: buildHookNotifyCommand(port, 'claude'),
              },
            ],
          },
        ],
      },
    },
    kiroHookCommand: buildHookNotifyCommand(port, 'kiro'),
  };

  return JSON.stringify(snippets, null, 2);
}

interface ClaudeHookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

function upsertEasyNotifyHook(
  existingList: unknown,
  command: string
): ClaudeHookEntry[] {
  const list: ClaudeHookEntry[] = Array.isArray(existingList)
    ? [...(existingList as ClaudeHookEntry[])]
    : [];

  const filtered = list.filter((entry) => {
    const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    return !hooks.some(
      (h) =>
        typeof h?.command === 'string' && h.command.includes('.easy-notifyyy')
    );
  });

  filtered.push({
    hooks: [
      {
        type: 'command',
        command,
      },
    ],
  });

  return filtered;
}

async function readJsonObjectOrEmpty(
  filePath: string
): Promise<Record<string, unknown>> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Expected JSON object in ${filePath}`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw new Error(
      `Could not parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function installClaudeCodeHooks(
  defaultPort: number,
  settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
): Promise<string> {
  const current = await readJsonObjectOrEmpty(settingsPath);
  const command = buildHookNotifyCommand(defaultPort, 'claude');

  const currentHooks =
    typeof current.hooks === 'object' && current.hooks !== null
      ? { ...(current.hooks as Record<string, unknown>) }
      : {};

  currentHooks.Stop = upsertEasyNotifyHook(currentHooks.Stop, command);
  currentHooks.Notification = upsertEasyNotifyHook(
    currentHooks.Notification,
    command
  );

  const updated = {
    ...current,
    hooks: currentHooks,
  };

  await fs.writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return settingsPath;
}

export async function installAntigravityMcpConfig(
  mcpStdioPath: string,
  configPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
): Promise<string> {
  const current = await readJsonObjectOrEmpty(configPath);
  const currentServers =
    typeof current.mcpServers === 'object' && current.mcpServers !== null
      ? { ...(current.mcpServers as Record<string, unknown>) }
      : {};

  currentServers['easy-notifyyy'] = {
    command: 'node',
    args: [mcpStdioPath],
  };

  const updated = {
    ...current,
    mcpServers: currentServers,
  };

  await fs.writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return configPath;
}
