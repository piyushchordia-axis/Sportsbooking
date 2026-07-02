import { Module } from '@nestjs/common';
import { HealthController, ReadinessController } from './health.controller';

/** Liveness (GET /api/healthz) + DB-aware readiness (GET /api/readyz). */
@Module({ controllers: [HealthController, ReadinessController] })
export class HealthModule {}
