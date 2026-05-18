import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { BPMAuthContext } from '@rytass/bpm-core-nestjs-module';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { ApiTestMemberEntity } from './api-test-member.entity';

export const API_SESSION_COOKIE_NAME = 'bpm_api_session';
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_SESSION_SECRET = 'bpm-api-session-secret';

interface ApiSessionPayload {
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly memberId: string;
}

export interface ApiAuthenticatedMember {
  readonly email: string;
  readonly expiresAt: string;
  readonly memberId: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

@Injectable()
export class ApiSessionService {
  constructor(
    @InjectRepository(ApiTestMemberEntity)
    private readonly testMemberRepository: Repository<ApiTestMemberEntity>,
  ) {}

  async login({
    identifier,
    password,
    response,
  }: {
    readonly identifier: string;
    readonly password: string;
    readonly response: Response;
  }): Promise<ApiAuthenticatedMember> {
    const member = await this.findMemberByIdentifier(identifier);

    if (
      !member ||
      !verifyApiTestMemberPassword(password, member.passwordHash)
    ) {
      throw new UnauthorizedException('Invalid BPM API credentials');
    }

    const now = Date.now();
    const payload: ApiSessionPayload = {
      expiresAt: now + DEFAULT_SESSION_TTL_MS,
      issuedAt: now,
      memberId: member.memberId,
    };

    response.cookie(API_SESSION_COOKIE_NAME, this.signPayload(payload), {
      httpOnly: true,
      maxAge: DEFAULT_SESSION_TTL_MS,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return this.buildAuthenticatedMember(payload, member);
  }

  logout(response: Response): { readonly ok: true } {
    response.clearCookie(API_SESSION_COOKIE_NAME, {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return { ok: true };
  }

  async readAuthenticatedMemberFromRequest(
    request: Request | undefined,
  ): Promise<ApiAuthenticatedMember | null> {
    const payload = this.readSessionPayloadFromRequest(request);

    if (!payload) {
      return null;
    }

    const member = await this.findMemberById(payload.memberId);

    return member ? this.buildAuthenticatedMember(payload, member) : null;
  }

  async readBPMAuthContextFromRequest(
    request: Request | undefined,
  ): Promise<BPMAuthContext | null> {
    const payload = this.readSessionPayloadFromRequest(request);

    if (!payload) {
      return null;
    }

    const member = await this.findMemberById(payload.memberId);

    if (!member) {
      return null;
    }

    return {
      memberId: member.memberId,
      metadata: {
        customFields: member.customFields,
        email: member.email,
        memberId: member.memberId,
        name: member.name,
      },
      permissions: member.permissions,
      roles: member.roles,
    };
  }

  async listPublicMembers(): Promise<
    readonly Pick<
      ApiAuthenticatedMember,
      'email' | 'memberId' | 'name' | 'roles'
    >[]
  > {
    const members = await this.testMemberRepository.find({
      order: { memberId: 'ASC' },
    });

    return members.map((member) => ({
      email: member.email,
      memberId: member.memberId,
      name: member.name,
      roles: member.roles,
    }));
  }

  private readSessionPayloadFromRequest(
    request: Request | undefined,
  ): ApiSessionPayload | null {
    const sessionCookie = readCookieValue(request, API_SESSION_COOKIE_NAME);

    if (!sessionCookie) {
      return null;
    }

    const payload = this.verifyToken(sessionCookie);

    if (!payload || payload.expiresAt <= Date.now()) {
      return null;
    }

    return payload;
  }

  private buildAuthenticatedMember(
    payload: ApiSessionPayload,
    member: ApiTestMemberEntity,
  ): ApiAuthenticatedMember {
    return {
      email: member.email,
      expiresAt: new Date(payload.expiresAt).toISOString(),
      memberId: member.memberId,
      name: member.name,
      permissions: member.permissions,
      roles: member.roles,
    };
  }

  private async findMemberByIdentifier(
    identifier: string,
  ): Promise<ApiTestMemberEntity | null> {
    const normalizedIdentifier = identifier.trim().toLocaleLowerCase();

    if (!normalizedIdentifier) {
      return null;
    }

    return this.testMemberRepository
      .createQueryBuilder('member')
      .where('lower(member.member_id) = :identifier', {
        identifier: normalizedIdentifier,
      })
      .orWhere('lower(member.email) = :identifier', {
        identifier: normalizedIdentifier,
      })
      .getOne();
  }

  private async findMemberById(
    memberId: string,
  ): Promise<ApiTestMemberEntity | null> {
    return this.testMemberRepository.findOne({ where: { memberId } });
  }

  private signPayload(payload: ApiSessionPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = this.createSignature(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  private verifyToken(token: string): ApiSessionPayload | null {
    const [encodedPayload, signature] = token.split('.');

    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = this.createSignature(encodedPayload);

    if (!safeCompare(signature, expectedSignature)) {
      return null;
    }

    return parseSessionPayload(encodedPayload);
  }

  private createSignature(encodedPayload: string): string {
    return createHmac(
      'sha256',
      process.env.API_SESSION_SECRET ?? DEFAULT_SESSION_SECRET,
    )
      .update(encodedPayload)
      .digest('base64url');
  }
}

function readCookieValue(
  request: Request | undefined,
  cookieName: string,
): string | null {
  const cookieHeader = request?.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  return (
    cookieHeader
      .split(';')
      .map((segment) => segment.trim())
      .map((segment): readonly [string, string] => {
        const separatorIndex = segment.indexOf('=');

        return separatorIndex === -1
          ? [segment, '']
          : [
              segment.slice(0, separatorIndex),
              segment.slice(separatorIndex + 1),
            ];
      })
      .find(([name]) => name === cookieName)?.[1] ?? null
  );
}

function parseSessionPayload(encodedPayload: string): ApiSessionPayload | null {
  try {
    const decodedPayload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<ApiSessionPayload>;

    if (
      typeof decodedPayload.expiresAt !== 'number' ||
      typeof decodedPayload.issuedAt !== 'number' ||
      typeof decodedPayload.memberId !== 'string'
    ) {
      return null;
    }

    return {
      expiresAt: decodedPayload.expiresAt,
      issuedAt: decodedPayload.issuedAt,
      memberId: decodedPayload.memberId,
    };
  } catch {
    return null;
  }
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyApiTestMemberPassword(
  password: string,
  passwordHash: string,
): boolean {
  if (!passwordHash.startsWith('sha256$')) {
    return false;
  }

  const expected = `sha256$${createHash('sha256')
    .update(password)
    .digest('hex')}`;

  return safeCompare(passwordHash, expected);
}
