import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OwnerStatus, UserRole } from '@sportsbooking/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateGameDto, CreateOwnerDto } from './dto';
import { SuperAdminService } from './super-admin.service';

@Controller('super-admin')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @Get('games')
  listGames() {
    return this.service.listGames();
  }

  @Post('games')
  createGame(@Body() dto: CreateGameDto) {
    return this.service.createGame(dto);
  }

  @Post('owners')
  createOwner(@Body() dto: CreateOwnerDto) {
    return this.service.createOwner(dto);
  }

  @Get('owners')
  listOwners() {
    return this.service.listOwners();
  }

  @Patch('owners/:id/status/:status')
  setStatus(@Param('id') id: string, @Param('status') status: OwnerStatus) {
    return this.service.setOwnerStatus(id, status);
  }
}
