import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { HealthController } from '../health/health.controller';
import { buildTypeOrmModuleOptions } from '../database/typeorm.config';
import { SystemResolver } from '../system/system.resolver';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['.env.local', '.env'],
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: buildTypeOrmModuleOptions,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      autoSchemaFile: true,
      driver: ApolloDriver,
      introspection: process.env.NODE_ENV !== 'production',
      path: '/graphql',
      playground: false,
      sortSchema: true,
    }),
  ],
  controllers: [HealthController],
  providers: [SystemResolver],
})
export class AppModule {}
