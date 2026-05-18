import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import {
  ApiAuthenticatedMember,
  ApiSessionService,
} from './api-session.service';

class ApiLoginInput {
  @IsString()
  readonly identifier!: string;

  @IsString()
  @MinLength(1)
  readonly password!: string;
}

interface ApiPublicMember {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  readonly roles: readonly string[];
}

@Controller('auth')
export class ApiAuthController {
  constructor(private readonly sessionService: ApiSessionService) {}

  @Get('test-members')
  listTestMembers(): Promise<readonly ApiPublicMember[]> {
    return this.sessionService.listPublicMembers();
  }

  @Get('me')
  async readCurrentMember(
    @Req() request: Request,
  ): Promise<ApiAuthenticatedMember> {
    const member =
      await this.sessionService.readAuthenticatedMemberFromRequest(request);

    if (!member) {
      throw new UnauthorizedException('BPM API session is required');
    }

    return member;
  }

  @Post('login')
  @HttpCode(200)
  login(
    @Body() input: ApiLoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiAuthenticatedMember> {
    return this.sessionService.login({
      identifier: input.identifier,
      password: input.password,
      response,
    });
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response): {
    readonly ok: true;
  } {
    return this.sessionService.logout(response);
  }
}
