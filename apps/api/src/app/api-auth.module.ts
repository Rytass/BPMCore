import { Module } from '@nestjs/common';
import { ApiAuthController } from './api-auth.controller';
import { ApiMemberResolver } from './api-member.resolver';
import { ApiSessionService } from './api-session.service';

@Module({
  controllers: [ApiAuthController],
  exports: [ApiMemberResolver, ApiSessionService],
  providers: [ApiMemberResolver, ApiSessionService],
})
export class ApiAuthModule {}
