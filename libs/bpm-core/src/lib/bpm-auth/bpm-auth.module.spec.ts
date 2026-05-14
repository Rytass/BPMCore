import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BPMAuthenticatedGuard } from './bpm-auth.guard';
import { BPMAuthModule } from './bpm-auth.module';

@Injectable()
class FeatureConsumer {
  constructor(readonly guard: BPMAuthenticatedGuard) {}
}

@Module({
  providers: [FeatureConsumer],
})
class FeatureModule {}

describe('BPMAuthModule', () => {
  it('makes BPMAuthenticatedGuard injectable from feature module contexts', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [BPMAuthModule.forRoot(), FeatureModule],
    }).compile();

    try {
      const consumer = moduleRef.get(FeatureConsumer);

      expect(consumer.guard).toBeInstanceOf(BPMAuthenticatedGuard);
    } finally {
      await moduleRef.close();
    }
  });
});
