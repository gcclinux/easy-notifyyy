import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  handleMcpJsonRpc,
  JsonRpcRequest,
  normalizeAgentSource,
  normalizeTaskStatus,
} from './mcpProtocol';
import { NotificationResult } from './notificationCoordinator';
import { AgentSource, AiTaskEvent, TaskStatus } from './types';

export interface ServerInfo {
  port: number;
  url: string;
  mcpUrl: string;
  notifyUrl: string;
  pid: number;
  updatedAt: string;
}

export function getDefaultServerInfoPath(): string {
  return path.join(os.homedir(), '.easy-notifyyy', 'server.json');
}

export function normalizeNotifyPayload(
  rawBody: Record<string, unknown>,
  querySource?: string
): AiTaskEvent {
  const hookEvent =
    typeof rawBody.hook_event_name === 'string' ? rawBody.hook_event_name : undefined;

  let source: AgentSource;
  if (querySource) {
    source = normalizeAgentSource(querySource);
  } else if (rawBody.source !== undefined) {
    source = normalizeAgentSource(rawBody.source);
  } else if (rawBody.agent !== undefined) {
    source = normalizeAgentSource(rawBody.agent);
  } else if (hookEvent) {
    source = 'claude';
  } else {
    source = 'mcp';
  }

  let status: TaskStatus = normalizeTaskStatus(rawBody.status);
  if (hookEvent === 'Notification') {
    status = rawBody.notification_type === 'error' ? 'error' : 'needs_input';
  } else if (hookEvent === 'Stop' || hookEvent === 'SubagentStop') {
    status = rawBody.status ? normalizeTaskStatus(rawBody.status) : 'completed';
  }

  const defaultTitle =
    hookEvent === 'Notification'
      ? `${source === 'kiro' ? 'Kiro' : 'Claude Code'} needs your input`
      : hookEvent
        ? `${source === 'kiro' ? 'Kiro' : 'Claude Code'} finished its task`
        : 'AI task ready for review';

  const title =
    typeof rawBody.title === 'string' && rawBody.title.trim()
      ? rawBody.title.trim()
      : defaultTitle;

  const summary =
    typeof rawBody.summary === 'string' && rawBody.summary.trim()
      ? rawBody.summary.trim()
      : typeof rawBody.message === 'string' && rawBody.message.trim()
        ? rawBody.message.trim()
        : undefined;

  let workspaceName =
    typeof rawBody.workspaceName === 'string' && rawBody.workspaceName.trim()
      ? rawBody.workspaceName.trim()
      : undefined;

  if (!workspaceName && typeof rawBody.cwd === 'string' && rawBody.cwd.trim()) {
    workspaceName = path.basename(rawBody.cwd.trim());
  }

  return {
    source,
    title,
    summary,
    status,
    workspaceName,
    timestamp:
      typeof rawBody.timestamp === 'string' ? rawBody.timestamp : undefined,
  };
}

export interface LocalNotifyServerOptions {
  port: number;
  serverInfoPath?: string;
  onEvent: (
    event: AiTaskEvent,
    options?: { force?: boolean }
  ) => Promise<NotificationResult>;
  log?: (message: string) => void;
}

export class LocalNotifyServer {
  private server: http.Server | undefined;
  private activePort = 0;
  private readonly serverInfoPath: string;

  constructor(private readonly options: LocalNotifyServerOptions) {
    this.serverInfoPath = options.serverInfoPath ?? getDefaultServerInfoPath();
  }

  get port(): number {
    return this.activePort;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.activePort}`;
  }

  async start(): Promise<ServerInfo> {
    if (this.server) {
      return this.buildServerInfo(this.activePort);
    }

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    const boundPort = await this.listenWithFallback(server, this.options.port);
    this.server = server;
    this.activePort = boundPort;

    const info = this.buildServerInfo(boundPort);
    await this.writeServerInfo(info);
    this.options.log?.(`Local notify/MCP server listening on ${info.url}`);
    return info;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.activePort = 0;

    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    try {
      const raw = await fs.readFile(this.serverInfoPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ServerInfo>;
      if (parsed.pid === process.pid) {
        await fs.unlink(this.serverInfoPath);
      }
    } catch {
      // Ignore missing or unreadable file on shutdown.
    }
  }

  private buildServerInfo(port: number): ServerInfo {
    const url = `http://127.0.0.1:${port}`;
    return {
      port,
      url,
      mcpUrl: `${url}/mcp`,
      notifyUrl: `${url}/notify`,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    };
  }

  private async writeServerInfo(info: ServerInfo): Promise<void> {
    await fs.mkdir(path.dirname(this.serverInfoPath), { recursive: true });
    await fs.writeFile(this.serverInfoPath, JSON.stringify(info, null, 2), 'utf8');
  }

  private listenWithFallback(
    server: http.Server,
    preferredPort: number
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
          this.options.log?.(
            `Port ${preferredPort} already in use; binding ephemeral port instead.`
          );
          server.removeListener('error', onError);
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve(typeof addr === 'object' && addr ? addr.port : 0);
          });
          return;
        }
        reject(err);
      };

      server.once('error', onError);
      server.listen(preferredPort, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : preferredPort);
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        this.sendJson(res, 200, {
          ok: true,
          pid: process.pid,
          port: this.activePort,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/notify') {
        const rawBody = await this.readJsonBody(req);
        const querySource = parsedUrl.searchParams.get('source') ?? undefined;
        const force =
          parsedUrl.searchParams.get('force') === 'true' ||
          rawBody.force === true;
        const event = normalizeNotifyPayload(rawBody, querySource);
        const result = await this.options.onEvent(event, { force });
        this.sendJson(res, 200, { ok: true, event, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/mcp') {
        const rawBody = await this.readJsonBody(req);
        const rpcResponse = await handleMcpJsonRpc(
          rawBody as JsonRpcRequest,
          (event) => this.options.onEvent(event)
        );
        if (!rpcResponse) {
          res.writeHead(202);
          res.end();
          return;
        }
        this.sendJson(res, 200, rpcResponse);
        return;
      }

      this.sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.log?.(`HTTP request error: ${message}`);
      this.sendJson(res, 400, { ok: false, error: message });
    }
  }

  private async readJsonBody(
    req: http.IncomingMessage
  ): Promise<Record<string, unknown>> {
    const maxBytes = 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        throw new Error('Request payload too large');
      }
      chunks.push(buf);
    }

    const rawText = Buffer.concat(chunks).toString('utf8').trim();
    if (!rawText) {
      return {};
    }

    const parsed = JSON.parse(rawText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object');
    }
    return parsed as Record<string, unknown>;
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    payload: unknown
  ): void {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}
