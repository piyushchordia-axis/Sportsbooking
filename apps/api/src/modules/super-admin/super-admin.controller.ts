import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateGameDto, CreateOwnerDto, UpdateGameDto } from './dto';
import { SuperAdminService, UpdateOwnerDto } from './super-admin.service';

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

  @Patch('games/:id')
  updateGame(@Param('id') id: string, @Body() dto: UpdateGameDto) {
    return this.service.updateGame(id, dto);
  }

  @Delete('games/:id')
  deleteGame(@Param('id') id: string) {
    return this.service.deleteGame(id);
  }

  @Post('owners')
  createOwner(@Body() dto: CreateOwnerDto) {
    return this.service.createOwner(dto);
  }

  @Get('owners')
  listOwners() {
    return this.service.listOwners();
  }

  @Patch('owners/:id')
  updateOwner(@Param('id') id: string, @Body() dto: UpdateOwnerDto) {
    return this.service.updateOwner(id, dto);
  }

  @Patch('owners/:id/status/:status')
  setStatus(@Param('id') id: string, @Param('status') status: string) {
    return this.service.setOwnerStatus(id, status);
  }
}
