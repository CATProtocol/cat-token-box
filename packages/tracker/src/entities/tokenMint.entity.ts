import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('token_mint')
@Index(['tokenPubKey', 'ownerPubKeyHash'])
export class TokenMintEntity {
  @PrimaryColumn({ length: 64 })
  txid: string;

  @Column({ name: 'token_pubkey', length: 64 })
  tokenPubKey: string;

  @Column({ name: 'owner_pkh' })
  @Index()
  ownerPubKeyHash: string;

  @Column({ name: 'token_amount', type: 'bigint' })
  tokenAmount: bigint;

  @Column({ name: 'block_height' })
  @Index()
  blockHeight: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
