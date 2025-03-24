import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('nft_info')
export class NftInfoEntity {
  @PrimaryColumn({ name: 'collection_id' })
  collectionId: string;

  @PrimaryColumn({ name: 'local_id', type: 'bigint' })
  localId: bigint;

  @Column({ name: 'mint_txid', length: 64 })
  @Index()
  mintTxid: string;

  @Column({ name: 'mint_height' })
  @Index()
  mintHeight: number;

  @Column({ name: 'commit_txid', length: 64 })
  commitTxid: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: object;

  @Column({ name: 'content_type', nullable: true })
  contentType: string;

  @Column({ name: 'content_encoding', nullable: true })
  contentEncoding: string;

  @Column({ name: 'content_raw', type: 'bytea', nullable: true })
  contentRaw: Buffer;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
