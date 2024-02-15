import '@unique-nft/opal-testnet-types/augment-api'
import '@unique-nft/opal-testnet-types/augment-api-tx'
import OpalDefinitions from '@unique-nft/opal-testnet-types/unique/definitions'

import {describe, test, expect, beforeAll, afterAll} from 'vitest'

import {Keyring} from '@polkadot/keyring'
import type {KeyringPair} from '@polkadot/keyring/types'
import {cryptoWaitReady} from '@polkadot/util-crypto'
import {ApiPromise, SubmittableResult, WsProvider} from '@polkadot/api'

import {SubmittableExtrinsic} from '@polkadot/api/promise/types'
import type {ISubmittableResult} from '@polkadot/types/types'
import {SchemaTools} from '@unique-nft/schemas'

////////////////////////////////////////////////
// necessary auxiliary methods for polkadot.js
////////////////////////////////////////////////

export class ExtrinsicError extends Error {
  txResult: ISubmittableResult

  constructor(txResult: SubmittableResult, errMessage: string, label?: string) {
    if (!label) {
      const info = txResult.dispatchInfo?.toHuman()
      label = `transaction ${info?.section}${info?.method}`
    }
    super(`Transaction failed: "${errMessage}"${label ? ' for' + label : ''}.`)
    this.txResult = txResult
  }
}

enum TransactionStatus {
  NOT_READY = 'NOT_READY',
  FAIL = 'FAIL',
  SUCCESS = 'SUCCESS'
}

const signAndSend = async <T extends SubmittableExtrinsic>(tx: T, account: KeyringPair) => {
  return new Promise<ISubmittableResult>(async (resolve, reject) => {
    let unsub = await tx.signAndSend(account, txResult => {
      const status = getTransactionStatus(txResult)

      if (status === TransactionStatus.SUCCESS) {
        unsub()
        resolve(txResult)
      } else if (status === TransactionStatus.FAIL) {
        let errMessage = ''

        if (txResult.dispatchError?.isModule) {
          // for module errors, we have the section indexed, lookup
          const decoded = tx.registry.findMetaError(txResult.dispatchError.asModule)
          const {docs, name, section} = decoded
          errMessage = `${section}.${name}: ${docs.join(' ')}`
        } else {
          // Other, CannotLookup, BadOrigin, no extra info
          errMessage = txResult.dispatchError?.toString() || 'Unknown error'
        }

        unsub()
        reject(new ExtrinsicError(txResult, errMessage))
      }
    })
  })
}

const getTransactionStatus = ({events, status}: SubmittableResult): TransactionStatus => {
  if (status.isReady || status.isBroadcast) {
    return TransactionStatus.NOT_READY
  }

  if (status.isInBlock || status.isFinalized) {
    if (events.find(e => e.event.data.method === 'ExtrinsicFailed')) {
      return TransactionStatus.FAIL
    }
    if (events.find(e => e.event.data.method === 'ExtrinsicSuccess')) {
      return TransactionStatus.SUCCESS
    }
  }

  return TransactionStatus.FAIL
}

///////////////////////////////////////////
// example
///////////////////////////////////////////

const createNFTCollection = async (api: ApiPromise, account: KeyringPair): Promise<number> => {
  const collectionData = SchemaTools.encode.collection({
    schemaName: 'unique',
    schemaVersion: '2.0.0',
    cover_image: {
      url: 'https://ipfs.unique.network/ipfs/QmcAcH4F9HYQtpqKHxBFwGvkfKb8qckXj2YWUrcc8yd24G/image1.png'
    },
  }, {})

  const result = await signAndSend(api.tx.unique.createCollectionEx({
    name: [97, 98, 99],
    description: [97, 98, 99],
    tokenPrefix: [97, 98, 99],
    permission: {
      nesting: {
        tokenOwner: true,
        collectionAdmin: true,
      }
    },
    properties: collectionData.collectionProperties.map(({key, valueHex}) => ({key, value: valueHex})),
    tokenPropertyPermissions: collectionData.tokenPropertyPermissions,
  }), account)

  const collectionIdStr = result.events.find(e => e.event.data.method === 'CollectionCreated')?.event.data[0].toHuman()
  const collectionId = parseInt(collectionIdStr as string || '')
  if (isNaN(collectionId)) {
    throw new Error('Collection id not found')
  }
  console.log(`Collection created with id ${collectionId}`)

  return collectionId
}

describe('demo', async () => {
  let api: ApiPromise
  let alice: KeyringPair
  let collectionId = 0

  beforeAll(async () => {
    await cryptoWaitReady()

    const keyring = new Keyring({type: 'sr25519'})
    alice = keyring.addFromUri('//Alice')

    // const provider = new WsProvider('wss://ws-opal.unique.network')
    const provider = new WsProvider('wss://ws.unq.uniq.su')
    api = await ApiPromise.create({provider, rpc: {unique: OpalDefinitions.rpc}})

    console.log(`Connection established to ${provider.endpoint}`)

    console.log(`Creating collection`)
    collectionId = await createNFTCollection(api, alice)
  })

  test('create collection', () => {
    expect(typeof collectionId).toBe('number')
    expect(collectionId).toBeGreaterThan(0)
  })

  test('get collection limits', async () => {
    const collection = await api.rpc.unique.collectionById(collectionId)
    const transfersEnabled = collection.unwrap().limits.transfersEnabled.toHuman()
    expect(transfersEnabled).toBeDefined()
    console.log(`For collection ${collectionId} transfersEnabled flag is:`, transfersEnabled)
  })

  afterAll(async () => {
    await api.disconnect()
  })
})
