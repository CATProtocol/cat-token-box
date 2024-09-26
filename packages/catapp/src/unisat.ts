'use client'

import { useEffect } from 'react'
import useSWR from 'swr'

declare global {
	interface Window {
		unisat: UnisatAPI
	}
}

export interface UnisatAPI {
	getAccounts: () => Promise<string[]>
	requestAccounts: () => Promise<string[]>
	getNetwork: () => Promise<string>
	getPublicKey: () => Promise<string>
	getBalance: () => Promise<{ confirmed: number; unconfirmed: number; total: number }>
	signMessage: (message: string, type: 'ecdsa' | 'bip322-simple') => Promise<string>
	signPsbt: (psbtHex: string, options?: {
		autoFinalized: boolean,
		toSignInputs: Array<{
			index: number,
			address?: string,
			publicKey?: string,
			sighashTypes?: number[],
			disableTweakSigner?: boolean,
		}>
	}) => Promise<string>
	getBitcoinUtxos: () => Promise<
		{ txid: string; vout: number; satoshis: number; scriptPk: string }[]
	>

	switchChain: (chain: string) => Promise<any>
	on: (event: string, callback: (...args: any[]) => void) => void
	removeListener: (event: string, callback: (...args: any[]) => void) => void // Added removeListener method
}

// Function to fetch wallet data
const fetchWalletData = async () => {
	if (typeof window.unisat === 'undefined') {
		return { address: '', isWalletConnected: false }
	}

	try {
		const accounts = await window.unisat.getAccounts()
		if (accounts.length > 0) {
			return { address: accounts[0], isWalletConnected: true }
		}
	} catch (error) {
		console.error('Error fetching wallet data:', error)
	}

	return { address: '', isWalletConnected: false }
}

export const useWallet = () => {
	const { data, mutate } = useSWR('wallet', fetchWalletData, {
		refreshInterval: 5000, // Refresh every 5 seconds
		revalidateOnFocus: false
	})

	const setAddress = (newAddress: string) => {
		// @ts-ignore
		mutate({ ...data, address: newAddress }, false)
	}

	const setIsWalletConnected = (isConnected: boolean) => {
		// @ts-ignore
		mutate({ ...data, isWalletConnected: isConnected }, false)
	}

	// Set up event listener for account changes
	useEffect(() => {
		const handleAccountsChanged = (accounts: string[]) => {
			mutate(
				accounts.length > 0
					? { address: accounts[0], isWalletConnected: true }
					: { address: '', isWalletConnected: false },
				false
			)
		}

		if (typeof window.unisat !== 'undefined') {
			window.unisat.on('accountsChanged', handleAccountsChanged)
		}

		return () => {
			if (typeof window.unisat !== 'undefined') {
				window.unisat.removeListener('accountsChanged', handleAccountsChanged)
			}
		}
	}, [mutate])

	return {
		address: data?.address || '',
		isWalletConnected: data?.isWalletConnected || false,
		setAddress,
		setIsWalletConnected
	}
}
