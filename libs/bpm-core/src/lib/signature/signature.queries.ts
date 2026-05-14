import { Args, Query, Resolver } from '@nestjs/graphql';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BPMAuthenticated } from '../bpm-auth';
import { SignatureEntity } from './signature.entity';
import { SignatureService } from './signature.service';
import { SignatureVerificationObject } from './signature-verification.object';

@Resolver()
@BPMAuthenticated()
export class SignatureQueries {
  constructor(
    @InjectRepository(SignatureEntity)
    private readonly signatureRepository: Repository<SignatureEntity>,
    private readonly signatureService: SignatureService,
  ) {}

  @Query(() => [SignatureEntity])
  async signatures(
    @Args('instanceId', { type: () => String }) instanceId: string,
  ): Promise<readonly SignatureEntity[]> {
    return this.signatureService.listSignatures(
      this.signatureRepository,
      instanceId,
    );
  }

  @Query(() => SignatureVerificationObject)
  async verifySignatureChain(
    @Args('instanceId', { type: () => String }) instanceId: string,
  ): Promise<SignatureVerificationObject> {
    return this.signatureService.verifyInstanceSignatureChain(
      this.signatureRepository,
      instanceId,
    );
  }
}
