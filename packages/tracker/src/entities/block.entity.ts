import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('block')
export class BlockEntity {
  @PrimaryColumn({ length: 64 })
  hash: string;

  @Column()
  @Index()
  height: number;

  @Column({ name: 'n_tx', default: 0 })
  nTx: number;

  @Column()
  time: number;

  @Column({ name: 'previous_hash', length: 64, nullable: true })
  previousHash: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
