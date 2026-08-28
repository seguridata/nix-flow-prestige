import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DemoService } from './demo.service';

@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Public()
  @Post('self-sign')
  selfSign(
    @Body() body: { signerId: string; name: string; email?: string },
  ) {
    return this.demo.createSelfSign(body);
  }
}
