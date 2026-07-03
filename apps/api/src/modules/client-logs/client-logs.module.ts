import { Module } from '@nestjs/common';
import { ClientLogsController } from './client-logs.controller';

/** Public client-side error telemetry sink (POST /api/client-logs). */
@Module({ controllers: [ClientLogsController] })
export class ClientLogsModule {}
