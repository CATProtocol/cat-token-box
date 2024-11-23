import { ByteString, FixedArray, hash160, toByteString } from 'scrypt-ts'
import { MAX_STATE, TxUtil } from '../contracts/utils/txUtil'
import { btc } from './btc'

const emptyString = toByteString('')

export type ProtocolStateList = FixedArray<ByteString, typeof MAX_STATE>

export class ProtocolState {
    public dataList?: ProtocolStateList
    public stateHashList: ProtocolStateList
    private constructor(
        stateHashList: ProtocolStateList,
        dataList?: ProtocolStateList
    ) {
        this.stateHashList = stateHashList
        this.dataList = dataList
    }

    get hashRoot(): ByteString {
        let hashData = ''
        for (let i = 0; i < this.stateHashList.length; i++) {
            hashData += hash160(this.stateHashList[i])
        }
        return hash160(hashData)
    }

    get stateScript(): Uint8Array {
        return new btc.Script(TxUtil.getStateScript(this.hashRoot)).toBuffer()
    }

    static toStateHashList(dataList: ProtocolStateList) {
        const stateHashList: ProtocolStateList = [
            emptyString,
            emptyString,
            emptyString,
            emptyString,
            emptyString,
        ]
        for (let i = 0; i < dataList.length; i++) {
            const data = dataList[i]
            if (data) {
                stateHashList[i] = hash160(data)
            }
        }

        return stateHashList
    }

    static fromDataList(dataList: ProtocolStateList): ProtocolState {
        return new ProtocolState(
            ProtocolState.toStateHashList(dataList),
            dataList
        )
    }

    static fromStateHashList(stateHashList: ProtocolStateList): ProtocolState {
        return new ProtocolState(stateHashList)
    }

    static getEmptyState(): ProtocolState {
        const dataList: ProtocolStateList = [
            emptyString,
            emptyString,
            emptyString,
            emptyString,
            emptyString,
        ]
        return ProtocolState.fromDataList(dataList)
    }

    updateDataList(index: number, data: ByteString): void {
        this.dataList[index] = data
        this.stateHashList = ProtocolState.toStateHashList(this.dataList)
    }

    static extractHashRootFromScript(script: Uint8Array): ByteString {
        // ('6a1863617401') + hashRoot
        return Buffer.from(script.slice(6)).toString('hex')
    }

}
