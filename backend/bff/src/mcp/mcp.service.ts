import { Injectable } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessService } from '../process/process.service';

const names = ['prestige_list_processes', 'prestige_list_formats', 'prestige_my_requests', 'prestige_my_tasks', 'prestige_request_status'] as const;
type ToolName = typeof names[number];
export const MCP_TOOLS = names.map((name, index) => ({
  name,
  description: [
    'Procesos publicados del tenant; devuelve solo la última versión de cada proceso.',
    'Formatos publicados disponibles para solicitudes del tenant.',
    'Solicitudes propias o en las que participa el usuario OAuth autenticado.',
    'Tareas asignadas al usuario OAuth autenticado, por fecha de vencimiento.',
    'Estado de una solicitud propia o en la que participa el usuario; incluye ejecución y sus tareas pendientes.',
  ][index],
  inputSchema: { type: 'object' as const, properties: index === 4 ? { requestId: { type: 'string', minLength: 1, maxLength: 100 } } : { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, required: index === 4 ? ['requestId'] : [], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));

@Injectable()
export class McpService {
  constructor(private readonly prisma: PrismaService, private readonly processes: ProcessService) {}

  async handle(req: Request & { user: AuthenticatedUser }, res: Response): Promise<void> {
    // A server/transport per request prevents session state or identities crossing requests/tenants.
    const server = new Server({ name: 'prestige', version: '1.0.0' }, { capabilities: { tools: {} } });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const name = request.params.name;
      if (!names.includes(name as ToolName)) throw new McpError(ErrorCode.InvalidParams, 'Herramienta desconocida');
      const args = request.params.arguments ?? {};
      const allowed = name === 'prestige_request_status' ? ['requestId'] : ['limit'];
      if (Object.keys(args).some(k => !allowed.includes(k))) throw new McpError(ErrorCode.InvalidParams, 'Argumentos no permitidos');
      if (name === 'prestige_request_status' && (typeof args.requestId !== 'string' || !args.requestId.trim() || args.requestId.length > 100)) throw new McpError(ErrorCode.InvalidParams, 'requestId requerido');
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 50)) throw new McpError(ErrorCode.InvalidParams, 'limit debe estar entre 1 y 50');
      try {
        const data = await this.query(name as ToolName, req.user, args);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { data } };
      } catch (error) {
        if (error instanceof McpError) throw error;
        // SQL, infrastructure URLs and provider errors must never leave the resource server.
        return { isError: true, content: [{ type: 'text', text: 'No fue posible consultar Prestige. Reintenta más tarde.' }] };
      }
    });
    res.on('close', () => { void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async query(name: ToolName, user: AuthenticatedUser, args: Record<string, unknown>) {
    const tenantId = user.tenantId;
    const take = Number(args.limit ?? 20);
    const participant = { OR: [{ requestedBy: user.actorId }, { signers: { some: { signerId: user.actorId } } }, { document: { case: { ownerId: user.actorId } } }] };
    if (name === 'prestige_list_processes') {
      const rows = await this.processes.listPublished(tenantId);
      return rows.slice(0, take).map(({ id, key, name, description, version, publishedAt }) => ({ id, key, name, description, version, publishedAt }));
    }
    if (name === 'prestige_list_formats') return this.prisma.documentTemplate.findMany({ where: { tenantId, published: true }, orderBy: { name: 'asc' }, take, select: { id: true, name: true, description: true, category: true, kind: true, flowKey: true, flowVersion: true } });
    if (name === 'prestige_my_tasks') return this.prisma.humanTask.findMany({ where: { tenantId, signerId: user.actorId, status: { in: ['CREADA', 'ASIGNADA'] } }, take, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], select: { id: true, name: true, signatureRequestId: true, status: true, dueAt: true, priority: true } });
    if (name === 'prestige_my_requests') return this.prisma.signatureRequest.findMany({ where: { tenantId, ...participant }, orderBy: { createdAt: 'desc' }, take, select: { id: true, status: true, createdAt: true, expiresAt: true, workflowRun: { select: { processKey: true, status: true, updatedAt: true } } } });
    const request = await this.prisma.signatureRequest.findFirst({ where: { tenantId, id: String(args.requestId), ...participant }, select: { id: true, status: true, createdAt: true, expiresAt: true, workflowRun: { select: { processKey: true, status: true, updatedAt: true } }, humanTasks: { where: { tenantId, signerId: user.actorId }, take: 50, select: { id: true, name: true, status: true, dueAt: true, completedAt: true } } } });
    if (!request) throw new McpError(ErrorCode.InvalidParams, 'Solicitud no disponible para este usuario');
    return request;
  }
}
