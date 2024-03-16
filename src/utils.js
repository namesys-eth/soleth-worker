import { keccak256, toHex, hexToCompactSignature, isHex } from 'viem';
import { getCoderByCoinName } from '@ensdomains/address-encoder';
import { hexToBytes } from '@ensdomains/address-encoder/utils';
import { getAddress as toChecksumAddr } from 'viem';

const SNS_PROXY = 'https://sns-sdk-proxy.bonfida.workers.dev';

export const recordMap = {
	'address/60': 'ETH',
	'address/eth': 'ETH',
	'address/501': 'SOL',
	'address/sol': 'SOL',
	'address/0': 'BTC',
	'address/btc': 'BTC',
	'address/2': 'LTC',
	'address/ltc': 'LTC',
	'address/3': 'DOGE',
	'address/doge': 'DOGE',
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

export async function setKV(KVStore, key, val, ttl) {
	console.log('KV Set:', key, val, ttl);
	await KVStore.put(key, val, { expirationTtl: ttl > 60 ? ttl : 60 });
	return val;
}

export async function getKV(KVStore, key) {
	return await KVStore.get(key);
}

export async function signRecord(env, domain, recType, result, metadata) {
	const signer = privateKeyToAccount(env.SIGNER_KEY);
	// \nGateway: https://${gateway}\
	const message = `Requesting Signature For ENS Record\n\
		\nDomain: ${domain}\
		\nResolver: eip155:1:${env.RESOLVER}\
		\nRecord Type: ${recType}\
		\nResult Hash: ${keccak256(result)}\
		\nMetadata Hash: ${keccak256(metadata)}`;
	const sig = hexToCompactSignature(await signer.signMessage({ message: message }));
	return sig.r + sig.yParityAndS.slice(2);
}
const DOMAIN_TTL = 86400 // 1 day
export async function domainRegd(env, domain) {
	const key = `DOMAINCHECK_${domain.replace(".", "_")}`
	const regd = await getKV(env.SOLCASA, key)
	if (regd === null) {
		const rpc = randomRPC(env.RPC_URLS);
		try {
			const result = await fetch(`${SNS_PROXY}/resolve/${domain}?rpc=${rpc}`, {
				cf: {
					cacheTtl: 300,
					cacheEverything: true,
				},
			});
			if (result.ok) {
				const data = await result.json();
				if (data.s === "ok") {
					return await setKV(env.SOLCASA, key, true, env.DOMAIN_TTL)
				}
			}
		} catch (error) {
			console.error(domain, error.message);
			return await setKV(env.SOLCASA, key, false, 15)
		}
		return await setKV(env.SOLCASA, key, false, 300)
	}
	console.log("KV Used:", key, regd)
	return regd
}

export async function getRecord(env, domain, recordType) {
	//const key = (`RECORD_${domain}/${recordType}`).replace('.', '_')
	//const value = await getKV(env.SOLCASA, key)
	//if (value !== null) {
	//	console.log("KV Used:", key, value)
	//	return value;
	//}
	const rpc = randomRPC(env.RPC_URLS);
	try {
		const result = await fetch(`${SNS_PROXY}/record-v2/${domain}/${recordType}?rpc=${rpc}`, {
			cf: {
				cacheTtl: env.RECORD_TTL,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			const data = await result.json();
			if (data.s === "ok") {
				return data.result.stale ? false : data.result.deserialized;
				//return data //await setKV(env.SOLCASA, key, data, env.RECORD_TTL)
			}
		}
	} catch (error) {
		console.error(domain, recordType, error.message);
		//return false //await setKV(env.SOLCASA, key, false, 15);
	}
	try {
		const result = await fetch(`${SNS_PROXY}/record/${domain}/${recordType}?rpc=${rpc}`, {
			cf: {
				cacheTtl: env.RECORD_TTL,
				cacheEverything: true,
			},
		});
		if (result.ok) {
			const data = await result.json();
			if (data.s === "ok") {
				return data.result //await setKV(env.SOLCASA, key, data.result, env.RECORD_TTL)
			}
		}
	} catch (error) {
		console.error(domain, recordType, error.message);
		// return false //await setKV(env.SOLCASA, key, false, 15);
	}
	return false //await setKV(env.SOLCASA, key, false, env.RECORD_TTL);
}

export const getContent = async (env, domain) => {
	const key = (`CONTENT_${domain}`).replace('.', '_')
	let result = await getKV(env.SOLCASA, key)
	if (result) {
		console.log("KV Used:", key, result)
		return result;
	}
	if (!await domainRegd(env, domain)) {
		return await setKV(env.SOLCASA, key, `https://www.sns.id/search?search=${domain}&ref=sol.casa`, env.CONTENT_TTL);
	}
	result = await getRecord(env, domain, "IPFS")
	if (result) {
		// TODO : Use CID decoder
		if (result.startsWith('k')) {
			result = `ipns://${result}`;
		} else {
			result = `ipfs://${result}`;
		}
	} else {
		result = await getRecord(env, domain, "ARWV")
		if (result) {
			result = `ar://${result}`
		} else {
			result = await getRecord(env, domain, "url")
			if (result) {
				result = result.startsWith("http") ? result : atob(result)
			} else {
				result = `https://www.sns.id/domain?domain=${domain.split(".")[0]}&ref=sol.casa`
			}
		}
	}
	return await setKV(env.SOLCASA, key, result, env.CONTENT_TTL)
}