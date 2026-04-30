import { Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class SystemResolver {
  @Query(() => String, {
    description: 'Simple GraphQL readiness query for local development.',
  })
  apiStatus(): string {
    return 'ok';
  }
}
