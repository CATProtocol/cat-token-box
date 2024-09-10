import { ByteString, FixedArray, hash160, toByteString } from 'scrypt-ts'
import { TxUtil } from '../contracts/utils/txUtil'
import { btc } from './btc'

const emptyString = toByteString('')

export type ProtocolStateList = FixedArray<ByteString, 5>

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

    get stateScript() {
        return new btc.Script(TxUtil.getStateScript(this.hashRoot))
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

    static fromDataList(dataList: ProtocolStateList) {
        return new ProtocolState(
            ProtocolState.toStateHashList(dataList),
            dataList
        )
    }

    static fromStateHashList(stateHashList: ProtocolStateList) {
        return new ProtocolState(stateHashList)
    }

    static getEmptyState() {
        const dataList: ProtocolStateList = [
            emptyString,
            emptyString,
            emptyString,
            emptyString,
            emptyString,
        ]
        return ProtocolState.fromDataList(dataList)
    }

    updateDataList(index: number, data: ByteString) {
        this.dataList[index] = data
        this.stateHashList = ProtocolState.toStateHashList(this.dataList)
    }
}
