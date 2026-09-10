import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { CollaborationService } from './collaboration.service';

class AddCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

class AddWatcherDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;
}

@Controller()
export class CollaborationController {
  constructor(private readonly collab: CollaborationService) {}

  @Get('documents/:id/comments')
  comments(@Param('id') id: string) {
    return this.collab.listComments(id);
  }

  @Post('documents/:id/comments')
  addComment(
    @Param('id') id: string,
    @Body() body: AddCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collab.addComment({
      documentId: id,
      authorId: user.actorId,
      authorName: user.name ?? user.actorId,
      body: body.body,
    });
  }

  @Get('me/notifications')
  notifications(@CurrentUser() user: AuthenticatedUser) {
    return this.collab.listNotifications(user.actorId);
  }

  @Patch('me/notifications/:id/read')
  read(@Param('id') id: string) {
    return this.collab.markRead(id);
  }

  @Post('me/notifications/read-all')
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.collab.markAllRead(user.actorId);
  }

  @Get('signature-requests/:id/watchers')
  watchers(@Param('id') id: string) {
    return this.collab.listWatchers(id);
  }

  @Post('signature-requests/:id/watchers')
  watch(
    @Param('id') id: string,
    @Body() body: AddWatcherDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collab.addWatcher(id, user.actorId, body.name ?? user.name ?? undefined);
  }

  @Get('signature-requests/:id/audit')
  audit(@Param('id') id: string) {
    return this.collab.listAudit({ signatureRequestId: id });
  }
}
