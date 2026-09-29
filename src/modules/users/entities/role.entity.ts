import { Column, Entity, PrimaryColumn, Unique } from 'typeorm';
import { RoleName } from '../../../common/enums/role-name.enum';

@Entity('roles')
@Unique('uq_roles_name', ['name'])
export class Role {
  @PrimaryColumn({ type: 'smallint', primaryKeyConstraintName: 'pk_roles' })
  id: number;

  @Column({ type: 'varchar', length: 20 })
  name: RoleName;
}
