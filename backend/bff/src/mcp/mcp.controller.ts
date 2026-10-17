import { All, Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { McpAuthGuard } from './mcp-auth.guard';
import { mcpConfig } from './mcp.config';
import { McpService } from './mcp.service';

@Controller()
@ApiExcludeController()
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Roles('admin', 'platform_admin')
  @Get('mcp/info')
  info() {
    const config = mcpConfig();
    if (!config.enabled) return { enabled: false, reason: config.reason };
    return { enabled: true, resource: config.resource, metadata: config.metadata, issuer: config.issuer, scope: config.scope, clientId: 'prestige-mcp-client', transport: 'streamable-http', authorization: 'authorization_code_pkce_s256', readOnly: true, tools: ['prestige_list_processes', 'prestige_list_formats', 'prestige_my_requests', 'prestige_my_tasks', 'prestige_request_status'] };
  }

  // Public metadata only. The MCP route bypasses web auth exclusively to apply its stricter resource guard.
  @Public()
  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp'])
  metadata(@Res() res: Response) {
    const config = mcpConfig();
    if (!config.enabled) return res.status(503).json({ error: 'MCP no está habilitado en este entorno' });
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ resource: config.resource, resource_name: 'Prestige', authorization_servers: [config.issuer], scopes_supported: [config.scope], bearer_methods_supported: ['header'] });
  }

  @Public()
  @UseGuards(McpAuthGuard)
  @All('mcp')
  handle(@Req() req: Request & { user: AuthenticatedUser }, @Res() res: Response) {
    return this.mcp.handle(req, res);
  }
}
