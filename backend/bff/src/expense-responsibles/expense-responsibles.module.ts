import { Module } from '@nestjs/common';
import { ExpenseResponsiblesController } from './expense-responsibles.controller';
import { ExpenseResponsiblesService } from './expense-responsibles.service';

@Module({
  controllers: [ExpenseResponsiblesController],
  providers: [ExpenseResponsiblesService],
  exports: [ExpenseResponsiblesService],
})
export class ExpenseResponsiblesModule {}
