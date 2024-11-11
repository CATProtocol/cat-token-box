import {
  NftGuardConstState,
  OpenMinterV2State,
} from "@cat-protocol/cat-smartcontracts";
import {
  ProtocolState,
  OpenMinterState,
  CAT721State,
  GuardConstState,
} from "@cat-protocol/cat-smartcontracts";
import { UTXO } from "scrypt-ts";

export interface ContractState<T> {
  protocolState: ProtocolState;

  data: T;
}

export interface Contract<T> {
  utxo: UTXO;
  state: ContractState<T>;
}

export type OpenMinterContract = Contract<OpenMinterState | OpenMinterV2State>;

export type GuardContract = Contract<GuardConstState>;

export type NFTContract = Contract<CAT721State>;

export type NftGuardContract = Contract<NftGuardConstState>;
