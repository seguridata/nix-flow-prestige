import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CollaborationService } from './collaboration.service';

@Controller()
export class CollaborationController {
  constructor(private readonly collab: CollaborationService) {}

  @Public()
  @Get('documents/:id/comments')
  comments(@Param('id') id: string) {
    return this.collab.listComments(id);
  }

  @Public()
  @Post('documents/:id/comments')
  addComment(
    @Param('id') id: string,
    @Body() body: { authorId: string; authorName: string; body: string },
  ) {
    return this.collab.addComment({ documentId: id, ...body });
  }

  @Public()
  @Get('me/notifications')
  notifications(@Query('userId') userId: string) {
    return this.collab.listNotifications(userId);
  }

  @Public()
  @Patch('me/notifications/:id/read')
  read(@Param('id') id: string) {
    return this.collab.markRead(id);
  }

  @Public()
  @Post('me/notifications/read-all')
  readAll(@Body() body: { userId: string }) {
    return this.collab.markAllRead(body.userId);
  }

  @Public()
  @Get('signature-requests/:id/watchers')
  watchers(@Param('id') id: string) {
    return this.collab.listWatchers(id);
  }

  @Public()
  @Post('signature-requests/:id/watchers')
  watch(
    @Param('id') id: string,
    @Body() body: { userId: string; name?: string },
  ) {
    return this.collab.addWatcher(id, body.userId, body.name);
  }

  @Public()
  @Get('signature-requests/:id/audit')
  audit(@Param('id') id: string) {
    return this.collab.listAudit({ signatureRequestId: id });
  }
}
