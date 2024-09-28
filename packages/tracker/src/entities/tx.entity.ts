import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('tx')
export class TxEntity {
  @PrimaryColumn({ length: 64 })
  txid: string;

  @Column({ name: 'block_height' })
  @Index()
  blockHeight: number;

  @Column({ name: 'tx_index' })
  txIndex: number; // tx index in block

  @Column({ name: 'state_hashes', nullable: true })
  stateHashes: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
