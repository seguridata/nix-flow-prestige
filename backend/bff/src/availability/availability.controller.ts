import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { AvailabilityService } from './availability.service';

class SetOutOfOfficeDto {
  @IsString() @MinLength(1) @MaxLength(200)
  delegateId!: string;

  @IsOptional() @IsString() @MaxLength(160)
  delegateName?: string;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  @IsOptional() @IsISO8601()
  since?: string;

  @IsOptional() @IsISO8601()
  until?: string;
}

@Controller('me/out-of-office')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.availability.get(user.actorId);
  }

  @Put()
  set(@Body() body: SetOutOfOfficeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.availability.set({
      userId: user.actorId,
      delegateId: body.delegateId,
      delegateName: body.delegateName,
      reason: body.reason,
      since: body.since ? new Date(body.since) : undefined,
      until: body.until ? new Date(body.until) : undefined,
    });
  }

  @Delete()
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.availability.clear(user.actorId);
  }
}
