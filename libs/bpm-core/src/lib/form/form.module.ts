import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FormDefinitionEntity } from './form-definition.entity';
import { FormDefinitionVersionEntity } from './form-definition-version.entity';
import { FormMutations } from './form.mutations';
import { FormQueries } from './form.queries';
import { FormService } from './form.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FormDefinitionEntity,
      FormDefinitionVersionEntity,
    ]),
  ],
  providers: [FormMutations, FormQueries, FormService],
  exports: [FormService],
})
export class FormModule {}
