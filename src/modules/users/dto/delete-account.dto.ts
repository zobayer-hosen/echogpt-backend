import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({
    example: 'Password123!',
    description: 'Current password, to confirm',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
