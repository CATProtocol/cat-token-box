import { ByteString, hash160, method, SmartContractLib } from 'scrypt-ts'

export type ClosedMinterState = {
    //
    tokenScript: ByteString
}

export class ClosedMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: ClosedMinterState): ByteString {
        return hash160(_state.tokenScript)
    }
}
