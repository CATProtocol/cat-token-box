import { TokenInfo } from '../common/types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('token_info')
export class TokenInfoEntity {
  @PrimaryColumn({ name: 'token_id' })
  tokenId: string;

  @Column({ name: 'reveal_txid' })
  @Index()
  revealTxid: string;

  @Column({ name: 'reveal_height' })
  revealHeight: number;

  @Column({ name: 'genesis_txid' })
  @Index()
  genesisTxid: string;

  @Column()
  name: string;

  @Column()
  symbol: string;

  @Column()
  decimals: number;

  @Column({ name: 'raw_info', type: 'jsonb' })
  rawInfo: TokenInfo;

  @Column({ name: 'minter_pubkey', length: 64 })
  @Index()
  minterPubKey: string;

  @Column({ name: 'token_pubkey', length: 64, nullable: true })
  @Index()
  tokenPubKey: string;

  @Column({ name: 'first_mint_height', nullable: true })
  @Index()
  firstMintHeight: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
