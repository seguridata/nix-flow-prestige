import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PageQueryDto } from '../common/pagination';
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
  comments(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.collab.listComments(id, user.tenantId);
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
      tenantId: user.tenantId,
    });
  }

  @Get('me/notifications')
  notifications(@Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.collab.listNotifications(user.actorId, user.tenantId, page);
  }

  @Patch('me/notifications/:id/read')
  read(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.collab.markRead(id, user.actorId, user.tenantId);
  }

  @Post('me/notifications/read-all')
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.collab.markAllRead(user.actorId, user.tenantId);
  }

  @Get('signature-requests/:id/watchers')
  watchers(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.collab.listWatchers(id, user.tenantId);
  }

  @Post('signature-requests/:id/watchers')
  watch(
    @Param('id') id: string,
    @Body() body: AddWatcherDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collab.addWatcher(id, user.actorId, user.tenantId, body.name ?? user.name ?? undefined);
  }

  @Get('signature-requests/:id/audit')
  audit(@Param('id') id: string, @Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.collab.listAudit({ signatureRequestId: id }, user.tenantId, page);
  }
}
