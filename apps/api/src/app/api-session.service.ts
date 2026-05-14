import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { BPMAuthContext } from '@bpm/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  findApiMemberProfile,
  findApiMemberProfileById,
} from './api-demo-members';

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
  login({
    identifier,
    password,
    response,
  }: {
    readonly identifier: string;
    readonly password: string;
    readonly response: Response;
  }): ApiAuthenticatedMember {
    const profile = findApiMemberProfile(identifier);

    if (!profile || profile.password !== password) {
      throw new UnauthorizedException('Invalid BPM API credentials');
    }

    const now = Date.now();
    const payload: ApiSessionPayload = {
      expiresAt: now + DEFAULT_SESSION_TTL_MS,
      issuedAt: now,
      memberId: profile.member.memberId,
    };

    response.cookie(API_SESSION_COOKIE_NAME, this.signPayload(payload), {
      httpOnly: true,
      maxAge: DEFAULT_SESSION_TTL_MS,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return this.buildAuthenticatedMember(payload);
  }

  logout(response: Response): { readonly ok: true } {
    response.clearCookie(API_SESSION_COOKIE_NAME, {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return { ok: true };
  }

  readAuthenticatedMemberFromRequest(
    request: Request | undefined,
  ): ApiAuthenticatedMember | null {
    const payload = this.readSessionPayloadFromRequest(request);

    return payload ? this.buildAuthenticatedMember(payload) : null;
  }

  readBPMAuthContextFromRequest(
    request: Request | undefined,
  ): BPMAuthContext | null {
    const payload = this.readSessionPayloadFromRequest(request);

    if (!payload) {
      return null;
    }

    const profile = findApiMemberProfileById(payload.memberId);

    if (!profile) {
      return null;
    }

    return {
      memberId: profile.member.memberId,
      metadata: {
        email: profile.member.email,
        memberId: profile.member.memberId,
        name: profile.member.name,
      },
      permissions: profile.permissions,
      roles: profile.roles,
    };
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
  ): ApiAuthenticatedMember {
    const profile = findApiMemberProfileById(payload.memberId);

    if (!profile) {
      throw new UnauthorizedException('BPM API session member was not found');
    }

    return {
      email: profile.member.email,
      expiresAt: new Date(payload.expiresAt).toISOString(),
      memberId: profile.member.memberId,
      name: profile.member.name,
      permissions: profile.permissions,
      roles: profile.roles,
    };
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

function parseSessionPayload(
  encodedPayload: string,
): ApiSessionPayload | null {
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
