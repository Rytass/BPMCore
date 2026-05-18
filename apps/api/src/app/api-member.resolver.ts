import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BPMMemberBaseResolverAdapter,
  type BPMMemberBaseDirectory,
  type BPMMemberResolver,
} from '@rytass/bpm-core-nestjs-module/identity';
import type { MemberMetadata } from '@rytass/bpm-core-shared';
import { Repository } from 'typeorm';
import {
  ApiTestMemberEntity,
  mapApiTestMemberToMetadata,
} from './api-test-member.entity';

@Injectable()
export class ApiMemberResolver
  extends BPMMemberBaseResolverAdapter<MemberMetadata>
  implements BPMMemberResolver
{
  constructor(
    @InjectRepository(ApiTestMemberEntity)
    testMemberRepository: Repository<ApiTestMemberEntity>,
  ) {
    super(createApiTestMemberDirectory(testMemberRepository));
  }

  override async resolve(memberId: string): Promise<MemberMetadata> {
    try {
      return await super.resolve(memberId);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new NotFoundException(
          `API test member ${memberId} was not found`,
        );
      }

      throw error;
    }
  }
}

function createApiTestMemberDirectory(
  testMemberRepository: Repository<ApiTestMemberEntity>,
): BPMMemberBaseDirectory<MemberMetadata> {
  return {
    resolveMember: async (memberId): Promise<MemberMetadata | null> => {
      const member = await testMemberRepository.findOne({
        where: { memberId },
      });

      return member ? mapApiTestMemberToMetadata(member) : null;
    },
    resolveMembers: async (memberIds): Promise<readonly MemberMetadata[]> => {
      if (!memberIds.length) {
        return [];
      }

      const members = await testMemberRepository
        .createQueryBuilder('member')
        .where('member.member_id IN (:...memberIds)', { memberIds })
        .orderBy('member.member_id', 'ASC')
        .getMany();

      return members.map(mapApiTestMemberToMetadata);
    },
    searchMembers: async (searchText): Promise<readonly MemberMetadata[]> => {
      const normalizedSearchText = searchText.trim().toLocaleLowerCase();
      const query = testMemberRepository
        .createQueryBuilder('member')
        .orderBy('member.member_id', 'ASC');

      if (!normalizedSearchText) {
        return (await query.getMany()).map(mapApiTestMemberToMetadata);
      }

      return (
        await query
          .where('lower(member.member_id) LIKE :searchText', {
            searchText: `%${normalizedSearchText}%`,
          })
          .orWhere('lower(member.email) LIKE :searchText', {
            searchText: `%${normalizedSearchText}%`,
          })
          .orWhere('lower(member.name) LIKE :searchText', {
            searchText: `%${normalizedSearchText}%`,
          })
          .getMany()
      ).map(mapApiTestMemberToMetadata);
    },
  };
}
