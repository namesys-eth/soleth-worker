import { keccak256, toHex, hexToCompactSignature, isHex } from 'viem';
import { getCoderByCoinName } from '@ensdomains/address-encoder';
import { hexToBytes } from '@ensdomains/address-encoder/utils';
import { getAddress as toChecksumAddr } from 'viem';

const SNS_PROXY = 'https://sns-sdk-proxy.bonfida.workers.dev';

export const recordMap = {
	'address/60': 'ETH',
	'address/eth': 'ETH',
	'address/501': 'SOL',
	'address/0': 'BTC',
	'address/2': 'LTC',
	'address/3': 'DOGE',
	'text/avatar': 'pic',
	'text/url': 'url',
	'text/com.discord': 'discord',
	'text/com.twitter': 'twitter',
	'text/com.reddit': 'reddit',
	'text/org.telegram': 'telegram',
	'text/com.github': 'github',
};
export function formatAddress(_ticker, data) {
	const coder = getCoderByCoinName(_ticker.toLowerCase());
	const addr = data.toLowerCase().startsWith('0x') ? toChecksumAddr(data) : data;
	return `0x${coder.decode(address)}`;
}
export function randomRPC(APIS) {
	const RPC = APIS.split(', ');
	return RPC[Math.floor(Math.random() * RPC.length)];
}

export async function setKV(kv, key, val, ttl) {
	console.log('KV Set:', key, val, ttl);
	await kv.put(key, val, { expirationTtl: ttl > 60 ? ttl : 60 });
	return val;
}

export async function getKV(kv, key) {
	//const val = 
	return await kv.get(key);
	//return val ? val : false;
}

export async function signRecord(env, gateway, recType, result) {
	const signer = privateKeyToAccount(env.SIGNER_KEY);
	const message = `Requesting Signature To Update ENS Record\n\
		\nGateway: https://${gateway}\
		\nResolver: eip155:1:${env.RESOLVER}\
		\nRecord Type: ${recType}\
		\nExtradata: ${keccak256(result)}\
		\nSigned By: eip155:1:${signer.address}`;
	const sig = hexToCompactSignature(await signer.signMessage({ message: message }));
	return sig.r + sig.yParityAndS.slice(2);
}

export async function proxySol(env, domain, recordType, ttl) {
	/*const key = (`${domain}/${recordType}`).replace('.', '_')
	const value = await getKV(env.SOLCASA, key)
	if (value) {
		console.log("KV Used:", key, value)
		return value;
	}*/
	const rpc = randomRPC(env.RPC_URLS);
	try {
		const result = await fetch(`${SNS_PROXY}/record-v2/${domain}/${recordType}?rpc=${rpc}`, {
			cf: {
				cacheTtl: ttl * 2,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			const data = await result.json();
			console.log("v2", recordType, domain, data.result)
			return data.result.stale ? false : data.result.deserialized;
			//return await setKV(env.SOLCASA, key, data, ttl)
		}
		throw new Error(result.statusText);
	} catch (err) {
		try {
			const result = await fetch(`${SNS_PROXY}/record/${domain}/${recordType}?rpc=${rpc}`, {
				cf: {
					cacheTtl: ttl * 2,
					cacheEverything: true,
				},
			});
			if (result.ok) {
				const data = await result.json();
				console.log("v1", recordType, domain, data.result)
				return data.result;
				//return await setKV(env.SOLCASA, key, data, ttl)
			}
			throw new Error(result.statusText);
		} catch (error) {
			console.error(error.message);
			return false;
		}
	}
}

export const getContent = async (env, domain, ttl) => {
	const key = (`CONTENT_${domain}`).replace('.', '_')
	let result = await getKV(env.SOLCASA, key)
	if (result !== null) {
		console.log("KV Used:", key, result)
		return result;
	}
	result = await proxySol(env, domain, "IPFS", ttl)
	if (result) {
		if (result.startsWith('k')) {
			result = `ipns://${result}`;
		} else {
			result = `ipfs://${result}`;
		}
	} else {
		result = await proxySol(env, domain, "ARWV", ttl)
		if (result) {
			result = `ar://${value}`
		} else {
			result = await proxySol(env, domain, "SHDW", ttl)
			if (result) {
				result = `shdw://${value}`
			} else {
				result = await proxySol(env, domain, "url", ttl)
				if (result) {
					result = atob(result)
				}
			}
		}
	}
	console.log(result, "__res", domain)
	return await setKV(env.SOLCASA, key, result, ttl)
}