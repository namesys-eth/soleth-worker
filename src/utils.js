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
	//console.log('KV Set:', key, val, ttl);
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
	const key = (`RECORD_${domain}/${recordType}`).replace('.', '_')
	const value = await getKV(env.SOLCASA, key)
	if (value !== null) {
		//console.log("KV Used:", key, value)
		return value;
	}
	const rpc = randomRPC(env.RPC_URLS);
	try {
		const result = await fetch(`${SNS_PROXY}/record-v2/${domain}/${recordType}?rpc=${rpc}`, {
			cf: {
				cacheTtl: ttl * 2,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			let data = await result.json();
			data = data.result.stale ? false : data.result.deserialized;
			return await setKV(env.SOLCASA, key, data, ttl)
		}
	} catch (err) {
		console.error(domain, recordType, error.message);
	}
	try {
		const result = await fetch(`${SNS_PROXY}/record/${domain}/${recordType}?rpc=${rpc}`, {
			cf: {
				cacheTtl: ttl * 2,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			const data = await result.json();
			return await setKV(env.SOLCASA, key, data.result, ttl)
		}
	} catch (error) {
		console.error(domain, recordType, error.message);
	}
	return await setKV(env.SOLCASA, key, false, ttl);
}

export const getContent = async (env, domain, ttl) => {
	const key = (`CONTENT_${domain}`).replace('.', '_')
	let result = await getKV(env.SOLCASA, key)
	if (result) {
		console.log("KV Used:_", key, result)
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
					result = result.startsWith("http") ? result : atob(result)
				} else {
					result = `https://www.sns.id/domain?domain=${domain.split(".")[0]}`
				}
			}
		}
	}
	return await setKV(env.SOLCASA, key, result, ttl)
}