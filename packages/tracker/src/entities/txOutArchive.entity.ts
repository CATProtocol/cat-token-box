import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('tx_out_archive')
export class TxOutArchiveEntity {
  @PrimaryColumn({ length: 64 })
  txid: string;

  @PrimaryColumn({ name: 'output_index' })
  outputIndex: number;

  @Column({ name: 'block_height' })
  blockHeight: number;

  @Column({ type: 'bigint' })
  satoshis: bigint;

  @Column({ name: 'locking_script' })
  lockingScript: string;

  @Column({ name: 'xonly_pubkey', nullable: true })
  xOnlyPubKey: string;

  @Column({ name: 'owner_pkh', nullable: true })
  ownerPubKeyHash: string;

  @Column({ name: 'token_amount', type: 'bigint', nullable: true })
  tokenAmount: bigint;

  @Column({ name: 'spend_txid', nullable: true })
  spendTxid: string;

  @Column({ name: 'spend_input_index', nullable: true })
  spendInputIndex: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
