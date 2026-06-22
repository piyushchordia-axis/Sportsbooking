import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Liveness/health endpoint (GET /api/healthz). */
@Module({ controllers: [HealthController] })
export class HealthModule {}
