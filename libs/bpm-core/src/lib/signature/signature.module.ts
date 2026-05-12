import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignatureEntity } from './signature.entity';
import { SignatureQueries } from './signature.queries';
import { SignatureService } from './signature.service';

@Module({
  imports: [TypeOrmModule.forFeature([SignatureEntity])],
  providers: [SignatureQueries, SignatureService],
  exports: [SignatureService],
})
export class SignatureModule {}
