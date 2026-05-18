import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiAuthController } from './api-auth.controller';
import { ApiMemberResolver } from './api-member.resolver';
import { ApiSessionService } from './api-session.service';
import { ApiTestMemberEntity } from './api-test-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiTestMemberEntity])],
  controllers: [ApiAuthController],
  exports: [ApiMemberResolver, ApiSessionService],
  providers: [ApiMemberResolver, ApiSessionService],
})
export class ApiAuthModule {}
